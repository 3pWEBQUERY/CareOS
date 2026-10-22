import Link from 'next/link'
import { cookies } from 'next/headers'
import type { Task } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { usersWithPermission } from '@/lib/notify'
import { ensureTasksForDay, isClosed, OPEN_STATUSES, taskView } from '@/lib/tasks'
import { taskTitle } from '@/lib/task-title'
import { shiftTypes } from '@/lib/shift'
import { shiftName } from '@/lib/shift-name'
import { addDays, currentShiftBounds, dateKey, fmtDayMonth, fromDbDate, hm, sameDay, shiftAt, shiftBounds, startOfDay } from '@/lib/time'
import { openDoses } from '@/lib/medication'
import { doseText } from '@/components/meds/dose'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { CreateTask, RememberFilter, TaskTable, type SeriesDto, type StaffDto, type TaskRowDto } from '@/components/tasks/TaskTable'
import { describeRecurrence, type TemplateDto } from '@/lib/recurrence'
import { categoryLabel } from '@/lib/care'
import { myResidentIds } from '@/lib/assignment'

export async function generateMetadata() {
  return { title: (await getCtx()).t('nav.tasks') }
}

/** Farbton der Kategorie wie im Stationsarbeitsplatz (Text bleibt immer sichtbar). */
const TONE: Record<string, string> = {
  Behandlungspflege: 'accent', Medikation: 'violet', Überwachung: 'warn', Aktivierung: 'ok', Assessment: 'accent', Organisation: 'outline',
}
const DEFAULT_CATEGORIES = ['Grundpflege', 'Behandlungspflege', 'Medikation', 'Ernährung', 'Mobilität', 'Überwachung', 'Aktivierung', 'Organisation']
const FILTERS = ['open', 'over', 'mine', 'done'] as const
const SYS_CATEGORIES: Record<string, string> = { Assessment: 'assessment', Organisation: 'organisation', Planung: 'planning', Qualität: 'quality' }

/** CareOS Tasks – Stationsansicht (PRD §12): offene Massnahmen der Schicht, Universal Actions. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ f?: string; s?: string; new?: string }> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, unit, user } = ctx
  if (!unit) return <main className="panel main" style={{ flex: 1 }}><div className="tabpanel"><Empty title={t('tasks.noUnit')} /></div></main>
  if (!ctx.canHere('task.read')) return <Forbidden text={t('common.notAllowed')} />
  const canManage = ctx.canHere('task.manage')
  const canComplete = ctx.canHere('task.complete')
  const canMeds = ctx.canHere('resident.medication.read')
  const canRound = ctx.canHere('resident.medication.administer')
  const canVisit = ctx.canHere('resident.read')

  const now = new Date()
  const today = startOfDay(now)
  const types = await shiftTypes(ctx.org.id)
  const running = shiftAt(types, now)
  const code = sp.s === 'day' || types.some((s) => s.code === sp.s) ? sp.s! : running?.code ?? 'day'
  const def = types.find((s) => s.code === code)
  let win: { start: Date; end: Date }
  if (!def) win = { start: today, end: addDays(today, 1) }
  else if (running && running.code === def.code) win = currentShiftBounds(def, now)
  else win = shiftBounds(def, today)
  // Filter bleibt pro Person gespeichert (Cookie je Benutzer), die URL bleibt die Quelle der Wahrheit.
  const isFilter = (v: string | undefined): v is (typeof FILTERS)[number] => (FILTERS as readonly string[]).includes(v ?? '')
  const saved = (await cookies()).get('careos_tasks_f_' + user.id)?.value
  const filter = isFilter(sp.f) ? sp.f : isFilter(saved) ? saved : 'open'

  await ensureTasksForDay(unit.id, win.start)
  if (!sameDay(win.start, win.end)) await ensureTasksForDay(unit.id, win.end)

  const [allTasks, residents, staffIds, mine] = await Promise.all([
    db.task.findMany({
      where: {
        unitId: unit.id,
        OR: [
          { dueAt: { gte: win.start, lt: win.end } },
          { dueAt: { gte: addDays(win.start, -1), lt: win.start }, status: { in: [...OPEN_STATUSES] } },
        ],
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    }),
    db.resident.findMany({ where: { unitId: unit.id, orgId: ctx.org.id, status: { in: ['active', 'absent'] } }, include: { room: true }, orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }] }),
    usersWithPermission(ctx.org.id, 'task.complete', unit.id),
    myResidentIds(ctx, { unitId: unit.id, now }),
  ])
  // Medikamentenaufgaben (Zeitpunkte, Wirkungskontrolle) nur für Personen, die abgeben dürfen – auch in den Zählern.
  const tasks = canRound ? allTasks : allTasks.filter((k) => k.source !== 'medication')
  const mineSet = new Set(mine ?? [])
  const ids = new Set<string>(staffIds)
  for (const k of tasks) [k.assigneeId, k.completedById, k.createdById].forEach((u) => u && ids.add(u))
  const users = await db.user.findMany({ where: { id: { in: [...ids] }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true, initials: true, active: true } })
  const uById = new Map(users.map((u) => [u.id, u]))
  const uName = (id: string | null) => { const u = id ? uById.get(id) : null; return u ? `${u.firstName.charAt(0)}. ${u.lastName}` : null }
  const rById = new Map(residents.map((r) => [r.id, r]))
  const doses = canMeds ? await openDoses(residents.filter((r) => r.status === 'active').map((r) => r.id), now, now) : []

  const open = tasks.filter((k) => !isClosed(k.status))
  const over = open.filter((k) => taskView(k, now) === 'over')
  const remaining = open.reduce((s, k) => s + k.durationMin, 0)
  const list = tasks.filter((k) => {
    if (filter === 'done') return isClosed(k.status) && k.dueAt >= win.start
    if (isClosed(k.status)) return false
    if (filter === 'over') return taskView(k, now) === 'over'
    // «Meine»: mir zugewiesen oder bei mir zugeteilten Personen und niemand anderem zugewiesen
    if (filter === 'mine') return k.assigneeId === user.id || (!k.assigneeId && !!k.residentId && mineSet.has(k.residentId))
    return true
  })

  const sourceLabel = (k: Task) => t('tasks.source.' + k.source)
  const seriesLabel = (x: Tpl) => describeRecurrence(t, seriesRule(x), x.times)
  /** Gespeicherte Kategorien (deutsch) in der App-Sprache anzeigen; eigene Kategorien bleiben, wie erfasst. */
  const catLabel = (c: string) => (SYS_CATEGORIES[c] ? t('tasks.categories.' + SYS_CATEGORIES[c]) : categoryLabel(t, c))
  // Wiederkehrende Aufgaben des Bereichs (für Rhythmus-Anzeige und «Serie bearbeiten»)
  const templates = await db.taskTemplate.findMany({ where: { unitId: unit.id, orgId: ctx.org.id }, orderBy: { title: 'asc' } })
  const tplById = new Map(templates.map((x) => [x.id, x]))
  const canAssess = ctx.canHere('resident.assessment.write')
  const canPlan = ctx.canHere('resident.careplan.edit')
  const canVitals = ctx.canHere('resident.vitals.write')
  /** Aufgaben, die sich mit der Dokumentation selbst schliessen (Document Once): Link statt Quittieren. */
  const docLink = (k: Task): TaskRowDto['link'] => {
    if (!k.residentId) return null
    if (k.source === 'assessment' && canAssess) return { href: `/residents/${k.residentId}/assessments?k=${encodeURIComponent(k.title.slice(11).split(':')[0])}`, label: t('tasks.toAssessment') }
    if (k.source === 'careplan' && k.title.startsWith('evaluation.') && canPlan) { const d = k.title.slice(11).split(':')[0]; return { href: `/residents/${k.residentId}/careplan?eval=${encodeURIComponent(d)}#dom-${encodeURIComponent(d)}`, label: t('tasks.toEvaluation') } }
    if (k.title === 'rule.vitalsRecheck' && canVitals) return { href: `/residents/${k.residentId}/vitals`, label: t('tasks.toVitals') }
    return null
  }
  const rows: TaskRowDto[] = list.map((k) => {
    const r = k.residentId ? rById.get(k.residentId) : null
    const title = taskTitle(t, k)
    const a = k.assigneeId ? uById.get(k.assigneeId) : null
    const medSlot = k.source === 'medication' && k.title === 'medication.slot'
    const prn = k.source === 'medication' && k.sourceId?.startsWith('prn:')
    return {
      id: k.id, time: hm(k.dueAt), day: sameDay(k.dueAt, now) ? null : fmtDayMonth(k.dueAt, ctx.locale), title, description: k.description, category: catLabel(k.category), catTone: TONE[k.category] ?? '',
      durationMin: k.durationMin, priority: k.priority, view: taskView(k, now), due: k.dueAt.toISOString(),
      resident: r ? { id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null } : null,
      assignee: a ? { id: a.id, initials: a.initials, name: `${a.firstName.charAt(0)}. ${a.lastName}` } : null,
      completed: k.completedAt ? t('tasks.completedBy', { time: hm(k.completedAt), by: uName(k.completedById) ?? '–' }) : null,
      note: k.note, createdBy: uName(k.createdById), sourceLabel: sourceLabel(k),
      link: k.residentId && medSlot && canMeds ? { href: `/residents/${k.residentId}/meds`, label: t('tasks.toMar') } : k.residentId && prn && canMeds ? { href: `/residents/${k.residentId}/meds#effect`, label: t('tasks.toEffect') } : k.residentId && k.source === 'order' && k.title === 'visit.order.medication' && canMeds ? { href: `/residents/${k.residentId}/meds#orders`, label: t('visit.task.toMeds') } : docLink(k),
      series: k.source === 'recurring' && k.sourceId && tplById.has(k.sourceId) ? { id: k.sourceId, label: seriesLabel(tplById.get(k.sourceId)!) } : null,
    }
  })
  const staff: StaffDto[] = users.filter((u) => staffIds.includes(u.id) && u.active).map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName}`, initials: u.initials })).sort((a, b) => a.name.localeCompare(b.name))
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...tasks.filter((k) => k.source === 'manual' || k.source === 'recurring').map((k) => k.category)])]
  const series: SeriesDto = {
    templates: templates.filter((x) => x.active).map(templateDto),
    residents: residents.filter((r) => r.status === 'active').map((r) => ({ id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, unitId: unit.id })),
    categories: cats, unitId: unit.id, unitName: unit.name, todayKey: dateKey(now),
  }

  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams()
    const v = { f: filter, s: code === (running?.code ?? 'day') ? null : code, ...patch }
    for (const [k, val] of Object.entries(v)) if (val) p.set(k, val)
    const s = p.toString()
    return '/tasks' + (s ? '?' + s : '')
  }
  const winLabel = def ? `${shiftName(t, def)} ${hm(win.start)}–${hm(win.end)}${sameDay(win.start, now) ? '' : ' · ' + fmtDayMonth(win.start, ctx.locale)}` : t('tasks.wholeDay', { date: fmtDayMonth(today, ctx.locale) })
  const nextHour = new Date(Math.ceil(now.getTime() / 1800_000) * 1800_000)

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <RememberFilter userId={user.id} value={filter} />
      <div className="view-head">
        <div>
          <span className="lbl">{t('tasks.station')} · {unit.name}</span>
          <h1>{t('tasks.title')}</h1>
          <p className="sub">{winLabel}</p>
        </div>
        <div className="seg seg-x" role="group" aria-label={t('tasks.filter.label')}>
          {FILTERS.map((f) => (
            <Link key={f} href={q({ f })} aria-current={filter === f ? 'page' : undefined} scroll={false}>{t('tasks.filter.' + f)}</Link>
          ))}
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="row-between">
            <nav className="seg seg-x" aria-label={t('tasks.shift.label')}>
              {types.map((s) => (
                <Link key={s.code} href={q({ s: s.code === running?.code ? null : s.code })} aria-current={code === s.code ? 'page' : undefined} scroll={false}>
                  {shiftName(t, s)}{running?.code === s.code ? ' · ' + t('tasks.shift.now') : ''}
                </Link>
              ))}
              <Link href={q({ s: running ? 'day' : null })} aria-current={code === 'day' ? 'page' : undefined} scroll={false}>{t('tasks.shift.day')}</Link>
            </nav>
            <div className="row">
              {canRound && <Link className="btn" href="/tasks/medround">{t('tasks.medround')}</Link>}
              {canVisit && <Link className="btn" href="/tasks/visit">{t('visit.nav')}</Link>}
              {canManage && (
                <CreateTask
                  initialOpen={sp.new === '1'}
                  residents={residents.map((r) => ({ id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null }))}
                  staff={staff}
                  categories={cats}
                  todayKey={dateKey(nextHour)}
                  defaultTime={hm(nextHour)}
                  meId={user.id}
                />
              )}
            </div>
          </div>

          <div className="metrics metrics-2">
            <a className="metric" href={q({ f: 'open' })}><span className="lbl">{t('tasks.metrics.open')}</span><span className="val">{open.length}</span></a>
            <a className="metric" href={q({ f: 'over' })}><span className="lbl">{t('tasks.metrics.over')}</span><span className={'val' + (over.length ? ' crit' : '')}>{over.length}</span></a>
            <div className="metric"><span className="lbl">{t('tasks.metrics.remaining')}</span><span className="val">{remaining} <small>{t('common.minutes')}</small></span></div>
            {canMeds && <a className="metric" href="#meds-open"><span className="lbl">{t('tasks.metrics.meds')}</span><span className={'val' + (doses.length ? ' crit' : '')}>{doses.length}</span></a>}
          </div>

          <TaskTable
            rows={rows}
            staff={staff}
            canManage={canManage}
            canComplete={canComplete}
            meId={user.id}
            series={canManage ? series : undefined}
            note={filter === 'mine' && !mine ? t('tasks.mineHint') : undefined}
            emptyText={t(filter === 'over' ? 'tasks.empty.over' : filter === 'mine' ? 'tasks.empty.mine' : filter === 'done' ? 'tasks.empty.done' : 'tasks.empty.open')}
          />

          {canMeds && doses.length > 0 && (
            <section className="stack-sm" id="meds-open" aria-labelledby="meds-open-h">
              <div className="sec-head">
                <h2 className="sec" id="meds-open-h">{t('tasks.medsOpen.title')}</h2>
                {canRound && <Link className="linkbtn small" href="/tasks/medround">{t('tasks.medround')} →</Link>}
              </div>
              <div className="tablewrap">
                <table className="stable" aria-labelledby="meds-open-h">
                  <thead>
                    <tr><th>{t('tasks.col.time')}</th><th>{t('tasks.col.resident')}</th><th>{t('tasks.col.task')}</th><th className="right">{t('admin.users.status')}</th></tr>
                  </thead>
                  <tbody>
                    {doses.map((d) => {
                      const r = rById.get(d.residentId)
                      return (
                        <tr key={d.medication.id + d.time} className="over">
                          <td className="mono" style={{ width: 70 }}>{d.time}</td>
                          <td>
                            <Link className="linkbtn" href={`/residents/${d.residentId}/meds`}>{r ? `${r.lastName} ${r.firstName}` : '–'}</Link>
                            {r?.room && <div className="small muted mono">{t('meds.roomShort', { room: r.room.number })}</div>}
                          </td>
                          <td>{d.medication.name}<div className="small muted mono">{doseText(d.dose, d.medication.form)} · {d.medication.route}</div></td>
                          <td className="right small crit-text nowrap">{t('meds.state.overdue')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  )
}

type Tpl = Awaited<ReturnType<typeof db.taskTemplate.findMany>>[number]
function seriesRule(x: Tpl) {
  return { rhythm: x.rhythm, every: x.every, weekdays: x.weekdays, monthDay: x.monthDay, startDate: fromDbDate(x.startDate) }
}
function templateDto(x: Tpl): TemplateDto {
  return {
    id: x.id, unitId: x.unitId, residentId: x.residentId, title: x.title, description: x.description, category: x.category, rhythm: x.rhythm, every: x.every,
    weekdays: x.weekdays, monthDay: x.monthDay, times: x.times, startDate: dateKey(fromDbDate(x.startDate)), endDate: x.endDate ? dateKey(fromDbDate(x.endDate)) : null,
    durationMin: x.durationMin, priority: x.priority, assigneeId: x.assigneeId, active: x.active,
  }
}
