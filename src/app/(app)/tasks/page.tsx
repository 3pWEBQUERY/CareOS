import Link from 'next/link'
import type { Task } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { usersWithPermission } from '@/lib/notify'
import { ensureTasksForDay, isClosed, OPEN_STATUSES, taskView } from '@/lib/tasks'
import { taskTitle } from '@/lib/task-title'
import { shiftTypes } from '@/lib/shift'
import { addDays, currentShiftBounds, dateKey, fmtDayMonth, hm, sameDay, shiftAt, shiftBounds, startOfDay } from '@/lib/time'
import { openDoses } from '@/lib/medication'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { CreateTask, TaskTable, type StaffDto, type TaskRowDto } from '@/components/tasks/TaskTable'

export const metadata = { title: 'Aufgaben' }

/** Farbton der Kategorie wie im Stationsarbeitsplatz (Text bleibt immer sichtbar). */
const TONE: Record<string, string> = {
  Behandlungspflege: 'accent', Medikation: 'violet', Überwachung: 'warn', Aktivierung: 'ok', Assessment: 'accent', Organisation: 'outline',
}
const DEFAULT_CATEGORIES = ['Grundpflege', 'Behandlungspflege', 'Medikation', 'Ernährung', 'Mobilität', 'Überwachung', 'Aktivierung', 'Organisation']
const FILTERS = ['open', 'over', 'mine', 'done'] as const

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
  const filter = (FILTERS as readonly string[]).includes(sp.f ?? '') ? (sp.f as (typeof FILTERS)[number]) : 'open'

  await ensureTasksForDay(unit.id, win.start)
  if (!sameDay(win.start, win.end)) await ensureTasksForDay(unit.id, win.end)

  const [tasks, residents, staffIds] = await Promise.all([
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
  ])
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
    if (filter === 'mine') return k.assigneeId === user.id
    return true
  })

  const sourceLabel = (k: Task) => t('tasks.source.' + k.source)
  const rows: TaskRowDto[] = list.map((k) => {
    const r = k.residentId ? rById.get(k.residentId) : null
    const title = taskTitle(t, k)
    const a = k.assigneeId ? uById.get(k.assigneeId) : null
    const medSlot = k.source === 'medication' && k.title === 'medication.slot'
    const prn = k.source === 'medication' && k.sourceId?.startsWith('prn:')
    return {
      id: k.id, time: hm(k.dueAt), day: sameDay(k.dueAt, now) ? null : fmtDayMonth(k.dueAt), title, description: k.description, category: k.category, catTone: TONE[k.category] ?? '',
      durationMin: k.durationMin, priority: k.priority, view: taskView(k, now),
      resident: r ? { id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null } : null,
      assignee: a ? { id: a.id, initials: a.initials, name: `${a.firstName.charAt(0)}. ${a.lastName}` } : null,
      completed: k.completedAt ? t('tasks.completedBy', { time: hm(k.completedAt), by: uName(k.completedById) ?? '–' }) : null,
      note: k.note, createdBy: uName(k.createdById), sourceLabel: sourceLabel(k),
      link: k.residentId && medSlot && canMeds ? { href: `/residents/${k.residentId}/meds`, label: t('tasks.toMar') } : k.residentId && prn && canMeds ? { href: `/residents/${k.residentId}/meds#effect`, label: t('tasks.toEffect') } : null,
    }
  })
  const staff: StaffDto[] = users.filter((u) => staffIds.includes(u.id) && u.active).map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName}`, initials: u.initials })).sort((a, b) => a.name.localeCompare(b.name))
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...tasks.filter((k) => k.source === 'manual').map((k) => k.category)])]

  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams()
    const v = { f: filter === 'open' ? null : filter, s: code === (running?.code ?? 'day') ? null : code, ...patch }
    for (const [k, val] of Object.entries(v)) if (val) p.set(k, val)
    const s = p.toString()
    return '/tasks' + (s ? '?' + s : '')
  }
  const winLabel = def ? `${def.name} ${hm(win.start)}–${hm(win.end)}${sameDay(win.start, now) ? '' : ' · ' + fmtDayMonth(win.start)}` : t('tasks.wholeDay', { date: fmtDayMonth(today) })
  const nextHour = new Date(Math.ceil(now.getTime() / 1800_000) * 1800_000)

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{t('tasks.station')} · {unit.name}</span>
          <h1>{t('tasks.title')}</h1>
          <p className="sub">{winLabel}</p>
        </div>
        <div className="seg seg-x" role="group" aria-label={t('tasks.filter.label')}>
          {FILTERS.map((f) => (
            <Link key={f} href={q({ f: f === 'open' ? null : f })} aria-current={filter === f ? 'page' : undefined} scroll={false}>{t('tasks.filter.' + f)}</Link>
          ))}
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="row-between">
            <nav className="seg seg-x" aria-label={t('tasks.shift.label')}>
              {types.map((s) => (
                <Link key={s.code} href={q({ s: s.code === running?.code ? null : s.code })} aria-current={code === s.code ? 'page' : undefined} scroll={false}>
                  {s.name}{running?.code === s.code ? ' · ' + t('tasks.shift.now') : ''}
                </Link>
              ))}
              <Link href={q({ s: running ? 'day' : null })} aria-current={code === 'day' ? 'page' : undefined} scroll={false}>{t('tasks.shift.day')}</Link>
            </nav>
            <div className="row">
              {canRound && <Link className="btn" href="/tasks/medround">{t('tasks.medround')}</Link>}
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

          <div className="metrics">
            <a className="metric" href={q({ f: null })}><span className="lbl">{t('tasks.metrics.open')}</span><span className="val">{open.length}</span></a>
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
            emptyText={t(filter === 'over' ? 'tasks.empty.over' : filter === 'mine' ? 'tasks.empty.mine' : filter === 'done' ? 'tasks.empty.done' : 'tasks.empty.open')}
          />

          {canMeds && doses.length > 0 && (
            <section className="stack-sm" id="meds-open" aria-labelledby="meds-open-h">
              <div className="sec-head">
                <h2 className="sec" id="meds-open-h">{t('tasks.medsOpen.title')}</h2>
                {canRound && <Link className="linkbtn small" href="/tasks/medround">{t('tasks.medround')} →</Link>}
              </div>
              <div className="tablewrap">
                <table className="stable">
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
                          <td>{d.medication.name}<div className="small muted mono">{d.dose}</div></td>
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
