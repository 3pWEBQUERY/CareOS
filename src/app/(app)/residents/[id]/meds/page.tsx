import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { usersWithPermission } from '@/lib/notify'
import { addDays, addMinutes, dateKey, fmtDayMonth, hm, parseDateKey, sameDay, startOfDay } from '@/lib/time'
import { cellsFor, EFFECT_CHECK_MIN, lowStock, medAppliesAt, prnStatus, scheduledMedsWhere, slotKey, slotsOf, stockDays, DEFAULT_SLOTS } from '@/lib/medication'
import { MarTable } from '@/components/meds/MarTable'
import { EffectChecks, PrnTable, type EffectDto, type PrnAdminDto, type PrnDto } from '@/components/meds/PrnTable'
import { Orders, type OrderDto } from '@/components/meds/Orders'
import type { MarRowDto, ResidentCtxDto } from '@/components/meds/types'
import { residentTitle } from '../../_lib/resident'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'meds')
}

/** CareOS Med (PRD §13): Abgabeliste, Reserve mit Wirkungskontrolle, Verordnungen, Bestand. */
export default async function MedsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ d?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await getCtx()
  const { t } = ctx
  const r = await residentInScope(ctx, id)
  if (!r) notFound()
  const scope = { unitId: r.unitId, locationId: r.unit.locationId }
  if (!ctx.can('resident.medication.read', scope)) return <div className="alert warn"><span className="grow">{t('common.notAllowed')}</span></div>

  const now = new Date()
  const today = startOfDay(now)
  let day = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? parseDateKey(sp.d) : today
  if (day > addDays(today, 7) || day < addDays(today, -60)) day = today
  const isToday = sameDay(day, today)
  const canAdminister = ctx.can('resident.medication.administer', scope)
  const canEdit = ctx.can('resident.medication.edit', scope)
  const editable = canAdminister && day <= today && day >= addDays(today, -1)

  const [scheduled, dayAdmins, prnMeds, prnAdmins, orders, colleagueIds, interaction] = await Promise.all([
    db.medication.findMany({ where: { residentId: r.id, ...scheduledMedsWhere(day) }, orderBy: [{ createdAt: 'asc' }] }),
    db.medicationAdministration.findMany({ where: { residentId: r.id, scheduledFor: { gte: day, lt: addDays(day, 1) } }, orderBy: { at: 'asc' } }),
    db.medication.findMany({ where: { residentId: r.id, kind: 'prn', active: true }, orderBy: { createdAt: 'asc' } }),
    db.medicationAdministration.findMany({ where: { residentId: r.id, scheduledFor: null, at: { gte: addDays(now, -2) } }, include: { medication: { select: { name: true } } }, orderBy: { at: 'desc' } }),
    db.medication.findMany({ where: { residentId: r.id, OR: [{ active: true }, { stoppedAt: { gte: addDays(now, -90) } }] }, orderBy: [{ active: 'desc' }, { kind: 'asc' }, { createdAt: 'asc' }] }),
    canAdminister ? usersWithPermission(ctx.org.id, 'resident.medication.doublecheck', r.unitId) : Promise.resolve([] as string[]),
    db.integration.findFirst({ where: { orgId: ctx.org.id, kind: 'drug_interactions', active: true } }),
  ])

  const userIds = new Set<string>([...colleagueIds])
  for (const a of [...dayAdmins, ...prnAdmins]) [a.byId, a.checkedById, a.voidedById].forEach((u) => u && userIds.add(u))
  for (const o of orders) userIds.add(o.createdById)
  const users = await db.user.findMany({ where: { id: { in: [...userIds] }, orgId: ctx.org.id }, select: { id: true, initials: true, firstName: true, lastName: true, active: true } })
  const ini = (uid: string | null | undefined) => (uid ? users.find((u) => u.id === uid)?.initials ?? '?' : null)
  const stamp = (d: Date) => (sameDay(d, now) ? hm(d) : fmtDayMonth(d) + ' ' + hm(d))

  // Abgabeliste
  const slotTimes = slotsOf(scheduled)
  const rows: MarRowDto[] = scheduled
    .map((m) => {
      const cells = cellsFor(m, slotTimes, day, dayAdmins.filter((a) => !a.voidedAt), now)
      return {
        id: m.id, name: m.name, form: m.form, route: m.route, indication: m.indication, notes: m.notes, kind: m.kind, requiresDoubleCheck: m.requiresDoubleCheck,
        stoppedAt: m.stoppedAt ? stamp(m.stoppedAt) : null,
        cells: cells.map((c) => c && {
          time: c.time, dose: c.dose || c.admin?.dose || '', applicable: c.applicable, state: c.state, over: c.over, adminId: c.admin?.id ?? '',
          at: c.admin ? hm(c.admin.at) : null, by: ini(c.admin?.byId), checkedBy: ini(c.admin?.checkedById), note: c.admin?.note ?? null,
          history: dayAdmins.filter((a) => a.medicationId === m.id && a.scheduledFor?.getTime() === c.at.getTime()).map((a) => ({
            id: a.id, status: a.status, at: stamp(a.at), by: ini(a.byId) ?? '?', checkedBy: ini(a.checkedById), note: a.note, voidedAt: a.voidedAt ? stamp(a.voidedAt) : null, voidedBy: ini(a.voidedById),
          })),
        }),
      }
    })
    .filter((row) => row.cells.some(Boolean))
  // Nur Spalten mit mindestens einer Dosis (abgesetzte Verordnungen hinterlassen sonst leere Zeitpunkte).
  const keep = slotTimes.map((_, i) => rows.some((row) => row.cells[i]))
  for (const row of rows) row.cells = row.cells.filter((_, i) => keep[i])
  const slots = slotTimes.filter((_, i) => keep[i]).map((time) => ({ time, key: slotKey(time) }))

  // Reserve
  const prnItems: PrnDto[] = prnMeds.filter((m) => medAppliesAt(m, now)).map((m) => {
    const st = prnStatus(m, prnAdmins, now)
    return {
      id: m.id, name: m.name, form: m.form, route: m.route, indication: m.indication, prnDose: m.prnDose ?? m.form ?? '', max: m.prnMaxPerDay, minIntervalH: m.prnMinIntervalH,
      count24: st.count24, lastAt: st.last ? stamp(st.last.at) + ' · ' + (ini(st.last.byId) ?? '') : null, nextAllowed: st.nextAllowed ? hm(st.nextAllowed) : null,
      full: st.full, requiresDoubleCheck: m.requiresDoubleCheck, stock: m.stock, stockUnit: m.stockUnit, low: lowStock(m),
    }
  })
  const recent: PrnAdminDto[] = prnAdmins.filter((a) => a.at >= addDays(now, -1)).map((a) => ({
    id: a.id, drug: a.medication.name, dose: a.dose ?? '', at: stamp(a.at), by: ini(a.byId) ?? '?', note: a.note, voided: !!a.voidedAt, effect: a.effectNote, mine: a.byId === ctx.user.id,
  }))
  const effects: EffectDto[] = prnAdmins.filter((a) => !a.voidedAt && a.status === 'given' && !a.effectAt && a.at >= addDays(now, -1)).map((a) => {
    const due = addMinutes(a.at, EFFECT_CHECK_MIN)
    return { adminId: a.id, drug: a.medication.name, dose: a.dose ?? '', at: stamp(a.at), by: ini(a.byId) ?? '?', due: hm(due), overdue: due < now }
  })

  // Verordnungen
  const orderDtos: OrderDto[] = orders.map((m) => ({
    id: m.id, name: m.name, form: m.form, route: m.route, indication: m.indication, kind: m.kind, times: m.times, doses: m.doses,
    prnDose: m.prnDose, prnMaxPerDay: m.prnMaxPerDay, prnMinIntervalH: m.prnMinIntervalH,
    start: fmtDayMonth(m.startDate) + m.startDate.getFullYear(), startKey: dateKey(m.startDate), end: m.endDate ? fmtDayMonth(m.endDate) + m.endDate.getFullYear() : null, endKey: m.endDate ? dateKey(m.endDate) : '',
    prescriber: m.prescriber, requiresDoubleCheck: m.requiresDoubleCheck, stock: m.stock, stockUnit: m.stockUnit, stockDays: stockDays(m), low: lowStock(m), notes: m.notes,
    active: m.active, stopped: m.stoppedAt ? fmtDayMonth(m.stoppedAt) + m.stoppedAt.getFullYear() + ' ' + hm(m.stoppedAt) : null, createdBy: ini(m.createdById) ?? '?',
  }))
  const low = orders.filter((m) => m.active && lowStock(m))

  const resident: ResidentCtxDto = { id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, allergies: r.allergies }
  const colleagues = users.filter((u) => colleagueIds.includes(u.id) && u.id !== ctx.user.id && u.active).map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName} (${u.initials})` })).sort((a, b) => a.name.localeCompare(b.name))
  const base = `/residents/${r.id}/meds`
  const dayHref = (d: Date) => (sameDay(d, today) ? base : `${base}?d=${dateKey(d)}`)
  const openOver = rows.reduce((n, row) => n + row.cells.filter((c) => c && c.state === 'open' && c.over).length, 0)

  return (
    <>
      <div className="sec-head">
        <h2 className="sec">{t('meds.mar.title', { date: fmtDayMonth(day) })}{!isToday && <span className="tag outline" style={{ marginLeft: 8, verticalAlign: 2 }}>{t(day < today ? 'meds.mar.past' : 'meds.mar.future')}</span>}</h2>
        <div className="row">
          <nav className="seg seg-x" aria-label={t('meds.mar.dayNav')}>
            <Link href={dayHref(addDays(day, -1))} scroll={false}>‹ {t('meds.mar.prevDay')}</Link>
            <Link href={base} scroll={false} aria-current={isToday ? 'page' : undefined}>{t('meds.mar.today')}</Link>
            <Link href={dayHref(addDays(day, 1))} scroll={false}>{t('meds.mar.nextDay')} ›</Link>
          </nav>
          <div className="mlegend" aria-label={t('meds.mar.legend')}>
            <span><i />{t('meds.state.open')}</span>
            <span><i className="g" />{t('meds.state.given')}</span>
            <span><i className="r" />{t('meds.mar.legendNotGiven')}</span>
            <span><i className="o" />{t('meds.state.overdue')}</span>
          </div>
        </div>
      </div>

      {openOver > 0 && editable && <div className="alert crit" role="status"><span className="grow">{t('meds.mar.overdueAlert', { n: openOver })}</span></div>}
      {low.length > 0 && (
        <div className="alert warn">
          <span className="grow"><strong>{t('meds.stock.lowTitle')}</strong>{low.map((m) => `${m.name} (${m.kind === 'prn' ? `${m.stock} ${m.stockUnit ?? ''}`.trim() : t('meds.stock.days', { n: stockDays(m) ?? 0 })})`).join(' · ')}</span>
        </div>
      )}

      {rows.length ? (
        <>
          <MarTable rows={rows} slots={slots} day={dateKey(day)} editable={editable} resident={resident} colleagues={colleagues} />
          <p className="small muted" style={{ margin: 0 }}>{t(editable ? 'meds.mar.hint' : canAdminister ? 'meds.mar.hintLocked' : 'meds.mar.hintReadOnly')}</p>
        </>
      ) : (
        <p className="muted" style={{ margin: 0 }}>{t('meds.mar.none')}</p>
      )}

      <div className="sec-head">
        <h2 className="sec">{t('meds.prn.title')}</h2>
        <span className="small muted">{t('meds.prn.sub')}</span>
      </div>
      <EffectChecks items={effects} canRecord={canAdminister} resident={resident} />
      <PrnTable items={prnItems} recent={recent} canGive={canAdminister} resident={resident} colleagues={colleagues} />

      <Orders orders={orderDtos} canEdit={canEdit} resident={resident} defaultSlots={[...new Set([...DEFAULT_SLOTS, ...slotsOf(orders.filter((o) => o.active))])].sort()} defaultPrescriber={r.physician} todayKey={dateKey(today)} />

      <section className="card" aria-labelledby="ia">
        <div className="card-head">
          <h3 id="ia">{t('meds.interactions.title')}</h3>
          <span className={'tag ' + (interaction ? 'ok' : 'outline')}>{interaction ? t('meds.interactions.connected') : t('meds.interactions.notConnected')}</span>
        </div>
        <div className="card-body small fg2">
          {interaction ? t('meds.interactions.connectedText', { name: interaction.name }) : t('meds.interactions.placeholder')}
        </div>
      </section>
    </>
  )
}
