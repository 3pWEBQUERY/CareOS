import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { usersWithPermission } from '@/lib/notify'
import { addDays, addMinutes, atTime, dateKey, fmtDayMonth, hm, startOfDay } from '@/lib/time'
import { cellsFor, scheduledMedsWhere, slotKey, slotsOf } from '@/lib/medication'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { RoundBlock, type RoundResidentDto } from '@/components/meds/RoundBlock'

export const metadata = { title: 'Medikamentenrunde' }

/** Medikamentenrunde (PRD §13.2): ablenkungsarme Ansicht eines Zeitpunkts für alle Personen der Station. */
export default async function MedRoundPage({ searchParams }: { searchParams: Promise<{ slot?: string }> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, unit } = ctx
  if (!unit) return <main className="panel main" style={{ flex: 1 }}><div className="tabpanel"><Empty title={t('tasks.noUnit')} /></div></main>
  if (!ctx.canHere('resident.medication.read')) return <Forbidden text={t('common.notAllowed')} />
  const editable = ctx.canHere('resident.medication.administer')
  const now = new Date()
  const day = startOfDay(now)

  const residents = await db.resident.findMany({ where: { unitId: unit.id, orgId: ctx.org.id, status: 'active' }, include: { room: true }, orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }] })
  const rIds = residents.map((r) => r.id)
  const [meds, admins, colleagueIds] = await Promise.all([
    db.medication.findMany({ where: { residentId: { in: rIds }, ...scheduledMedsWhere(day) }, orderBy: { createdAt: 'asc' } }),
    db.medicationAdministration.findMany({ where: { residentId: { in: rIds }, scheduledFor: { gte: day, lt: addDays(day, 1) }, voidedAt: null } }),
    editable ? usersWithPermission(ctx.org.id, 'resident.medication.doublecheck', unit.id) : Promise.resolve([] as string[]),
  ])
  const slots = slotsOf(meds).filter((s) => meds.some((m) => cellsFor(m, [s], day, admins, now)[0]))

  // Gewählter oder aktueller Zeitpunkt: der späteste Zeitpunkt bis 90 Min. voraus, sonst der nächste.
  const openAt = (time: string) => meds.some((m) => cellsFor(m, [time], day, admins, now)[0]?.state === 'open' && cellsFor(m, [time], day, admins, now)[0]?.applicable)
  let slot = sp.slot && slots.includes(sp.slot) ? sp.slot : ''
  if (!slot) {
    const near = slots.filter((s) => atTime(day, s) <= addMinutes(now, 90))
    slot = near.length ? near[near.length - 1] : slots[0] ?? ''
  }
  const earlierOpen = slots.filter((s) => s < slot && openAt(s))

  const users = await db.user.findMany({ where: { orgId: ctx.org.id, OR: [{ id: { in: colleagueIds } }, { id: { in: admins.flatMap((a) => [a.byId, a.checkedById].filter((x): x is string => !!x)) } }] }, select: { id: true, initials: true, firstName: true, lastName: true, active: true } })
  const ini = (id: string | null) => (id ? users.find((u) => u.id === id)?.initials ?? '?' : null)
  const colleagues = users.filter((u) => colleagueIds.includes(u.id) && u.id !== ctx.user.id && u.active).map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName} (${u.initials})` })).sort((a, b) => a.name.localeCompare(b.name))

  const blocks: RoundResidentDto[] = []
  for (const r of residents) {
    const lines = meds.filter((m) => m.residentId === r.id).flatMap((m) => {
      const c = cellsFor(m, [slot], day, admins, now)[0]
      if (!c) return []
      return [{
        id: m.id, name: m.name, form: m.form, route: m.route, indication: m.indication, notes: m.notes, kind: m.kind, requiresDoubleCheck: m.requiresDoubleCheck, stoppedAt: null,
        cells: [{ time: slot, dose: c.dose || c.admin?.dose || '', applicable: c.applicable, state: c.state, over: c.over, adminId: c.admin?.id ?? '', at: c.admin ? hm(c.admin.at) : null, by: ini(c.admin?.byId ?? null), checkedBy: ini(c.admin?.checkedById ?? null), note: c.admin?.note ?? null, history: [] }],
      }]
    })
    if (lines.length) blocks.push({ resident: { id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, allergies: r.allergies }, risks: r.risks.filter((x) => /schluck|dysphag|aspir|déglut|deglut|swallow/i.test(x)), lines })
  }
  const done = blocks.filter((b) => b.lines.every((l) => l.cells[0]!.state !== 'open')).length
  const pct = blocks.length ? Math.round((done / blocks.length) * 100) : 0

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{t('meds.round.label')} · {unit.name} · {fmtDayMonth(day)}</span>
          <h1>{slot ? `${t('meds.slots.' + slotKey(slot))} ${slot}` : t('meds.round.label')}</h1>
        </div>
        <div className="row">
          {slots.length > 0 && (
            <nav className="seg seg-x" aria-label={t('meds.round.slot')}>
              {slots.map((s) => <Link key={s} href={`/tasks/medround?slot=${s}`} aria-current={s === slot ? 'page' : undefined} scroll={false}>{t('meds.slots.' + slotKey(s))} <span className="mono">{s}</span></Link>)}
            </nav>
          )}
          <Link className="btn" href="/tasks">{t('meds.round.exit')}</Link>
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="round">
            {blocks.length > 0 ? (
              <>
                <div className="stack-sm" aria-live="polite">
                  <div className="row-between">
                    <strong>{t('meds.round.progress', { n: done, total: blocks.length })}</strong>
                    <span className="small muted">{t('meds.round.hint')}</span>
                  </div>
                  <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={blocks.length} aria-valuenow={done} aria-label={t('meds.round.progress', { n: done, total: blocks.length })}><i className={done === blocks.length ? 'ok' : ''} style={{ width: pct + '%' }} /></div>
                </div>
                {earlierOpen.length > 0 && (
                  <div className="alert warn">
                    <span className="grow">
                      <strong>{t('meds.round.earlierOpen')}</strong>
                      {earlierOpen.map((s, i) => <span key={s}>{i ? ', ' : ''}<Link href={`/tasks/medround?slot=${s}`}>{t('meds.slots.' + slotKey(s))} {s}</Link></span>)}
                    </span>
                  </div>
                )}
                {!editable && <div className="alert info"><span className="grow">{t('meds.mar.hintReadOnly')}</span></div>}
                {blocks.map((b) => <RoundBlock key={b.resident.id + slot} data={b} time={slot} slotKey={slotKey(slot)} day={dateKey(day)} editable={editable} colleagues={colleagues} />)}
              </>
            ) : (
              <Empty title={t('meds.round.empty')} />
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
