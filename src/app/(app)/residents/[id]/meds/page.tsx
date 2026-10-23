import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { usersWithPermission } from '@/lib/notify'
import { addDays, addMinutes, dateKey, fmtDate, fmtDayMonth, hm, parseDateKey, sameDay, startOfDay } from '@/lib/time'
import { cellsFor, EFFECT_CHECK_MIN, lowStock, medAppliesAt, prnStatus, scheduledMedsWhere, slotKey, slotsOf, stockDays, DEFAULT_SLOTS } from '@/lib/medication'
import { MarTable } from '@/components/meds/MarTable'
import { EffectChecks, PrnTable, type EffectDto, type PrnAdminDto, type PrnDto } from '@/components/meds/PrnTable'
import { Orders, type OrderDto } from '@/components/meds/Orders'
import type { MarRowDto, ResidentCtxDto } from '@/components/meds/types'
import { residentTitle } from '../../_lib/resident'
import { checkAllergies } from '@/lib/allergy-check'
import { checkInteractions, providerFor, SEVERITY_ORDER } from '@/lib/integrations/drug-interactions'
import { confirmState, needsConfirmation, phoneOrderHours } from '@/lib/phone-orders'
import { orderingPhysicians } from '@/lib/medication-orders'

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
  const canPhone = ctx.can('resident.medication.phone_order', scope)
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
  for (const o of orders) [o.createdById, o.confirmedById].forEach((u) => u && userIds.add(u))
  const [users, physicians] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...userIds] }, orgId: ctx.org.id }, select: { id: true, initials: true, firstName: true, lastName: true, active: true } }),
    canPhone ? orderingPhysicians(ctx.org.id, r) : Promise.resolve([]),
  ])
  const fullName = (uid: string | null) => { const u = uid ? users.find((x) => x.id === uid) : null; return u ? `${u.firstName} ${u.lastName}` : null }
  const ini = (uid: string | null | undefined) => (uid ? users.find((u) => u.id === uid)?.initials ?? '?' : null)
  const stamp = (d: Date) => (sameDay(d, now) ? hm(d) : fmtDayMonth(d, ctx.locale) + ' ' + hm(d))

  // Abgabeliste
  const slotTimes = slotsOf(scheduled)
  const rows: MarRowDto[] = scheduled
    .map((m) => {
      const cells = cellsFor(m, slotTimes, day, dayAdmins.filter((a) => !a.voidedAt), now)
      return {
        id: m.id, name: m.name, form: m.form, route: m.route, indication: m.indication, notes: m.notes, kind: m.kind, requiresDoubleCheck: m.requiresDoubleCheck,
        stoppedAt: m.stoppedAt ? stamp(m.stoppedAt) : null, unconfirmed: needsConfirmation(m.orderSource) && !m.confirmedAt, allergy: checkAllergies(r.allergies, [m.name, m.form].filter(Boolean).join(' ')),
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
    start: fmtDate(m.startDate, ctx.locale), startKey: dateKey(m.startDate), end: m.endDate ? fmtDate(m.endDate, ctx.locale) : null, endKey: m.endDate ? dateKey(m.endDate) : '',
    prescriber: m.prescriber, requiresDoubleCheck: m.requiresDoubleCheck, stock: m.stock, stockUnit: m.stockUnit, stockDays: stockDays(m), low: lowStock(m), notes: m.notes,
    active: m.active, stopped: m.stoppedAt ? fmtDate(m.stoppedAt, ctx.locale) + ' ' + hm(m.stoppedAt) : null, createdBy: ini(m.createdById) ?? '?',
    atc: m.atc, gtin: m.gtin, source: m.orderSource as OrderDto['source'], confirm: confirmState(m, now),
    confirmDue: m.confirmDueAt ? stamp(m.confirmDueAt) : null, confirmedBy: fullName(m.confirmedById), confirmedAt: m.confirmedAt ? stamp(m.confirmedAt) : null,
    mineToConfirm: canEdit && m.createdById !== ctx.user.id && needsConfirmation(m.orderSource) && !m.confirmedAt,
  }))
  const low = orders.filter((m) => m.active && lowStock(m))
  // Interaktionsprüfung über die Schnittstelle (PRD §13.1); ohne Datenquelle ausdrücklich «nicht geprüft»
  const ia = await checkInteractions(providerFor(interaction), orders.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, atc: m.atc, gtin: m.gtin })), ctx.locale)
  const iaText = ia.status === 'checked'
    ? (ia.interactions.length ? null : t('meds.interactions.none', { name: ia.source, at: hm(new Date(ia.checkedAt)) }))
    : t(ia.reason === 'not_configured' ? 'meds.interactions.notConfigured' : ia.reason === 'no_adapter' ? 'meds.interactions.noAdapter' : 'meds.interactions.error', { name: ia.source ?? '' })
  const iaNote = ia.status === 'checked' ? t('meds.interactions.orderNoteChecked', { name: ia.source }) : t(ia.reason === 'error' ? 'meds.interactions.orderNoteError' : 'meds.interactions.orderNote')

  const resident: ResidentCtxDto = { id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, allergies: r.allergies, photoId: r.photoFileId }
  const colleagues = users.filter((u) => colleagueIds.includes(u.id) && u.id !== ctx.user.id && u.active).map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName} (${u.initials})` })).sort((a, b) => a.name.localeCompare(b.name))
  const base = `/residents/${r.id}/meds`
  const dayHref = (d: Date) => (sameDay(d, today) ? base : `${base}?d=${dateKey(d)}`)
  const openOver = rows.reduce((n, row) => n + row.cells.filter((c) => c && c.state === 'open' && c.over).length, 0)

  return (
    <>
      <div className="sec-head">
        <h2 className="sec">{t('meds.mar.title', { date: fmtDayMonth(day, ctx.locale) })}{!isToday && <span className="tag outline" style={{ marginLeft: 8, verticalAlign: 2 }}>{t(day < today ? 'meds.mar.past' : 'meds.mar.future')}</span>}</h2>
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

      <Orders orders={orderDtos} canEdit={canEdit} canPhone={canPhone} physicians={physicians} phoneHours={phoneOrderHours(ctx.org.settings)} resident={resident} defaultSlots={[...new Set([...DEFAULT_SLOTS, ...slotsOf(orders.filter((o) => o.active))])].sort()} defaultPrescriber={r.physician} todayKey={dateKey(today)} interactionNote={iaNote} />

      <section className="card" aria-labelledby="ia">
        <div className="card-head">
          <h3 id="ia">{t('meds.interactions.title')}</h3>
          <span className={'tag ' + (ia.status === 'checked' ? 'ok' : 'warn')}>{t(ia.status === 'checked' ? 'meds.interactions.checked' : 'meds.interactions.notChecked')}</span>
        </div>
        <div className="card-body small fg2">
          {iaText && <p style={{ margin: 0 }}>{iaText}</p>}
          {ia.status === 'checked' && ia.interactions.length > 0 && (
            <ul className="list">
              {[...ia.interactions].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)).map((x, i) => (
                <li key={i}><div className="li">
                  <span className={'tag ' + (x.severity === 'contraindicated' || x.severity === 'major' ? 'crit' : x.severity === 'moderate' ? 'warn' : '')}>{t('meds.interactions.severity.' + x.severity)}</span>
                  <span><strong>{x.drugs.join(' + ')}</strong> · {x.text}{x.management ? ' ' + x.management : ''}</span>
                </div></li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
