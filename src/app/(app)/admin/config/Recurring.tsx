import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { usersWithPermission } from '@/lib/notify'
import { dateKey, fmtDayMonth, fromDbDate, startOfDay } from '@/lib/time'
import { describeRecurrence, nextOccurrence, type TemplateDto } from '@/lib/recurrence'
import { Empty } from '@/components/ui/Empty'
import { RecurringAdd, RecurringRow } from './RecurringClient'

const CATEGORIES = ['Grundpflege', 'Behandlungspflege', 'Medikation', 'Ernährung', 'Mobilität', 'Überwachung', 'Aktivierung', 'Organisation']

/** Admin → Klinische Konfiguration → Wiederkehrende Aufgaben (PRD §12.1, §45 Workflow: Aufgaben). */
export async function Recurring() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  const unitIds = ctx.units.map((u) => u.id)
  const [templates, residents] = await Promise.all([
    db.taskTemplate.findMany({ where: { orgId: ctx.org.id, unitId: { in: unitIds } }, orderBy: [{ active: 'desc' }, { title: 'asc' }] }),
    db.resident.findMany({ where: { orgId: ctx.org.id, unitId: { in: unitIds }, status: { in: ['active', 'absent'] } }, select: { id: true, firstName: true, lastName: true, unitId: true, room: { select: { number: true } } }, orderBy: { lastName: 'asc' } }),
  ])
  const staffEntries = await Promise.all(ctx.units.map(async (u) => [u.id, await usersWithPermission(ctx.org.id, 'task.complete', u.id)] as const))
  const users = await db.user.findMany({ where: { orgId: ctx.org.id, active: true, id: { in: [...new Set(staffEntries.flatMap(([, ids]) => ids))] } }, select: { id: true, firstName: true, lastName: true, initials: true } })
  const staff = Object.fromEntries(staffEntries.map(([unitId, ids]) => [unitId, users.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName}`, initials: u.initials })).sort((a, b) => a.name.localeCompare(b.name))]))
  const people = residents.map((r) => ({ id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, unitId: r.unitId }))
  const cats = [...new Set([...CATEGORIES, ...templates.map((x) => x.category)])]
  const units = ctx.units.map((u) => ({ id: u.id, name: u.name }))
  const today = startOfDay()
  const common = { units, residents: people, staff, categories: cats, todayKey: dateKey(today), defaultUnitId: ctx.unit?.id ?? null }

  const rows = templates.map((x) => {
    const rule = { rhythm: x.rhythm, every: x.every, weekdays: x.weekdays, monthDay: x.monthDay, startDate: fromDbDate(x.startDate), endDate: x.endDate ? fromDbDate(x.endDate) : null }
    const next = x.active ? nextOccurrence(rule, today) : null
    const dto: TemplateDto = {
      id: x.id, unitId: x.unitId, residentId: x.residentId, title: x.title, description: x.description, category: x.category, rhythm: x.rhythm, every: x.every,
      weekdays: x.weekdays, monthDay: x.monthDay, times: x.times, startDate: dateKey(rule.startDate), endDate: rule.endDate ? dateKey(rule.endDate) : null,
      durationMin: x.durationMin, priority: x.priority, assigneeId: x.assigneeId, active: x.active,
    }
    return {
      dto,
      rhythm: describeRecurrence(t, rule),
      times: x.times.join(', '),
      unit: units.find((u) => u.id === x.unitId)?.name ?? '–',
      resident: x.residentId ? people.find((p) => p.id === x.residentId)?.name ?? '–' : null,
      next: next ? fmtDayMonth(next, locale) : null,
    }
  })

  return (
    <div className="stack">
      <div className="row-between">
        <p className="fg2" style={{ margin: 0, maxWidth: '72ch' }}>{t('tasks.recur.admin.hint')}</p>
        <RecurringAdd {...common} />
      </div>
      {rows.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead>
              <tr>
                <th>{t('tasks.col.task')}</th>
                <th>{t('tasks.recur.admin.rhythm')}</th>
                <th>{t('tasks.recur.times')}</th>
                <th>{t('tasks.recur.unitField')}</th>
                <th>{t('tasks.recur.admin.next')}</th>
                <th>{t('tasks.recur.admin.status')}</th>
                <th><span className="sr-only">{t('admin.common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.dto.id}>
                  <th scope="row" style={{ fontWeight: 500 }}>
                    {r.dto.title}
                    {r.resident && <div className="small muted">{r.resident}</div>}
                  </th>
                  <td className="small">{r.rhythm}</td>
                  <td className="mono small">{r.times}</td>
                  <td className="small">{r.unit}</td>
                  <td className="mono small">{r.next ?? '–'}</td>
                  <td>{r.dto.active ? <span className="tag ok">{t('tasks.recur.admin.active')}</span> : <span className="tag">{t('tasks.recur.admin.ended')}</span>}</td>
                  <td className="right nowrap"><RecurringRow template={r.dto} {...common} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={t('tasks.recur.admin.empty')}>{t('tasks.recur.admin.emptyHint')}</Empty>
      )}
    </div>
  )
}
