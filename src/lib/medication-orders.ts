import 'server-only'
import type { MedicationKind } from '@prisma/client'
import { db } from '@/lib/db'
import type { ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notifyT } from '@/lib/notify-t'
import { usersWithPermission } from '@/lib/notify'
import { ensureTasksForDay, invalidateTaskGeneration } from '@/lib/tasks'
import { addDays, parseDateKey, startOfDay } from '@/lib/time'
import { syncSlotTask } from '@/lib/medication'
import { blocking, checkAllergies } from '@/lib/allergy-check'
import { checkInteractions, providerFor, type DrugRef } from '@/lib/integrations/drug-interactions'
import { drugList, gate, reasonOk, type Gate } from '@/lib/interaction-gate'
import { parseCodes } from '@/lib/medication-codes'
import { confirmDueAt, confirmState, isOrderSource, mayConfirm, needsConfirmation, phoneOrderHours, type OrderSource } from '@/lib/phone-orders'
import type { Ctx } from '@/lib/context'

/**
 * Verordnungen erfassen, ändern, gegenzeichnen (PRD §13, §32) – gemeinsam für Stationsapp und Ärzteportal.
 * Die aufrufende Action prüft Sitzung und Bewohnerbezug und übergibt die Rechte (`canPrescribe`, `canPhone`).
 */
type Actor = Pick<Ctx, 'org' | 'user' | 't' | 'locale' | 'sessionId' | 'ip' | 'userAgent'>
export type OrderResident = { id: string; orgId: string; unitId: string; firstName: string; lastName: string; allergies: string[]; physician: string | null }

const fd = (form: FormData, k: string) => {
  const v = form.get(k)
  return typeof v === 'string' ? v.trim() : ''
}
const fdNum = (form: FormData, k: string) => {
  const v = fd(form, k).replace(',', '.')
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}
const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })

const activeNow = (now = new Date()) => ({ from: { lte: now }, OR: [{ until: null }, { until: { gt: now } }] })
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const KINDS: MedicationKind[] = ['regular', 'prn', 'temporary']

/** Ärztinnen und Ärzte, die eine telefonische Anordnung für diese Person geben können (Konten). */
export async function orderingPhysicians(orgId: string, r: { id: string; unitId: string }) {
  const [internal, external] = await Promise.all([
    usersWithPermission(orgId, 'resident.medication.edit', r.unitId),
    db.residentPhysician.findMany({ where: { residentId: r.id, ...activeNow(), user: { orgId, active: true, kind: 'external_physician' } }, select: { userId: true } }),
  ])
  const ids = [...new Set([...internal, ...external.map((u) => u.userId)])]
  const users = await db.user.findMany({ where: { id: { in: ids }, orgId, active: true }, select: { id: true, firstName: true, lastName: true, jobTitle: true, kind: true } })
  return users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, hint: u.jobTitle ?? '', external: u.kind === 'external_physician' })).sort((a, b) => a.name.localeCompare(b.name))
}

/** Interaktionsprüfung für einen Entwurf gegen die übrigen aktiven Verordnungen (Codes ATC/GTIN, sonst Namen). */
export async function interactionGate(orgId: string, residentId: string, draft: DrugRef, replacesId: string | null, locale: string): Promise<Gate> {
  const [integration, active] = await Promise.all([
    db.integration.findFirst({ where: { orgId, kind: 'drug_interactions', active: true } }),
    db.medication.findMany({ where: { residentId, active: true }, select: { id: true, name: true, atc: true, gtin: true } }),
  ])
  const res = await checkInteractions(providerFor(integration), drugList(draft, active, replacesId), locale)
  return gate(res, draft.name)
}

export type GateDto = { level: Gate['level']; source: string | null; reason?: Gate['reason']; needsReason: boolean; hits: { drugs: string; severity: string; text: string }[] }
export const gateDto = (g: Gate): GateDto => ({ level: g.level, source: g.source, reason: g.reason, needsReason: g.needsReason, hits: g.hits.map((h) => ({ drugs: h.drugs.join(' + '), severity: h.severity, text: [h.text, h.management].filter(Boolean).join(' ') })) })

/**
 * Neue Verordnung oder Änderung. Änderungen setzen die alte Verordnung ab und legen eine neue an (Verlauf bleibt).
 * Ohne Verordnungsrecht nur als telefonische/mündliche Anordnung mit Name der anordnenden Person (Gegenzeichnung nötig).
 */
export async function saveOrder(ctx: Actor, r: OrderResident, form: FormData, rights: { canPrescribe: boolean; canPhone: boolean; external?: boolean }): Promise<ActionResult & { medId?: string; times?: string[] }> {
  const { t } = ctx
  const editId = fd(form, 'id')
  const old = editId ? await db.medication.findFirst({ where: { id: editId, residentId: r.id } }) : null
  if (editId && (!old || !old.active)) return err('meds.errors.orderInactive')

  // Herkunft: ärztlich erfasst (Verordnungsrecht) oder telefonisch/mündlich entgegengenommen
  const wanted = fd(form, 'orderSource') || 'written'
  if (!isOrderSource(wanted)) return err('common.genericError', 'orderSource')
  let source: OrderSource = wanted
  if (rights.external) source = 'written'
  if (!rights.canPrescribe) {
    if (!rights.canPhone) return err('common.notAllowed')
    if (source === 'written') return err('meds.phone.errors.sourceRequired', 'orderSource')
  }
  let orderedById: string | null = null
  let orderedByName: string | null = null
  if (needsConfirmation(source)) {
    const raw = fd(form, 'orderedBy')
    if (raw.length < 3) return err('meds.phone.errors.orderedBy', 'orderedBy')
    const physicians = await orderingPhysicians(ctx.org.id, r)
    const hit = physicians.find((p) => p.id === raw)
    orderedById = hit?.id ?? null
    orderedByName = hit?.name ?? raw.slice(0, 120)
  }

  const name = fd(form, 'name')
  if (name.length < 2) return err('meds.errors.name', 'name')
  const kind = fd(form, 'kind') as MedicationKind
  if (!KINDS.includes(kind)) return err('common.genericError', 'kind')
  const codes = parseCodes({ atc: fd(form, 'atc'), gtin: fd(form, 'gtin') })
  if (codes.error) return err(codes.error.key, codes.error.field)
  const times: string[] = []
  const doses: string[] = []
  if (kind !== 'prn') {
    for (let i = 0; i < 6; i++) {
      const time = fd(form, 'time_' + i)
      const dose = fd(form, 'dose_' + i)
      if (!dose || dose === '0') continue
      if (!TIME_RE.test(time)) return err('meds.errors.time', 'time_' + i)
      if (times.includes(time)) return err('meds.errors.timeDuplicate', 'time_' + i)
      times.push(time)
      doses.push(dose)
    }
    if (!times.length) return err('meds.errors.noDose', 'dose_0')
    const order = times.map((tm, i) => [tm, doses[i]] as const).sort((a, b) => a[0].localeCompare(b[0]))
    times.splice(0, times.length, ...order.map((o) => o[0]))
    doses.splice(0, doses.length, ...order.map((o) => o[1]))
  }
  const prnDose = fd(form, 'prnDose')
  const prnMax = fdNum(form, 'prnMaxPerDay')
  const prnInt = fdNum(form, 'prnMinIntervalH')
  if (kind === 'prn') {
    if (!prnDose) return err('meds.errors.prnDose', 'prnDose')
    if (prnMax == null || Number.isNaN(prnMax) || prnMax < 1 || prnMax > 24 || !Number.isInteger(prnMax)) return err('meds.errors.prnMaxInvalid', 'prnMaxPerDay')
    if (prnInt != null && (Number.isNaN(prnInt) || prnInt < 0 || prnInt > 72 || !Number.isInteger(prnInt))) return err('meds.errors.prnIntervalInvalid', 'prnMinIntervalH')
  }
  const now = new Date()
  const startKey = fd(form, 'startDate')
  let start = startKey ? parseDateKey(startKey) : now
  if (start <= now) start = now
  const endKey = fd(form, 'endDate')
  const end = endKey ? parseDateKey(endKey) : null
  if (kind === 'temporary' && !end) return err('meds.errors.endDate', 'endDate')
  if (end && end < startOfDay(start)) return err('meds.errors.endBeforeStart', 'endDate')
  const stock = fdNum(form, 'stock')
  if (stock != null && (Number.isNaN(stock) || stock < 0 || !Number.isInteger(stock))) return err('meds.errors.stock', 'stock')
  const reason = fd(form, 'changeReason')
  if (old && reason.length < 3) return err('meds.errors.changeReason', 'changeReason')
  // Allergie-Abgleich (PRD §13.1, §32): Treffer nur mit Begründung, Begründung wird protokolliert
  const allergyHits = checkAllergies(r.allergies, [name, fd(form, 'form')].join(' '))
  const allergyReason = fd(form, 'allergyReason').slice(0, 500)
  if (blocking(allergyHits) && allergyReason.length < 5) return err('meds.allergy.required', 'allergyReason')
  // Interaktionsprüfung vor dem Speichern (Datenquelle über Adapter); kontraindiziert nur mit Begründung
  const ia = await interactionGate(ctx.org.id, r.id, { name, atc: codes.atc, gtin: codes.gtin }, old?.id ?? null, ctx.locale)
  const iaReason = fd(form, 'interactionReason').slice(0, 500)
  if (!reasonOk(ia, iaReason)) return err('meds.interactions.reasonRequired', 'interactionReason')

  const phone = needsConfirmation(source)
  const data = {
    residentId: r.id, name, kind, form: fd(form, 'form') || null, route: fd(form, 'route') || 'p.o.', indication: fd(form, 'indication') || null,
    times, doses, prnDose: kind === 'prn' ? prnDose : null, prnMaxPerDay: kind === 'prn' ? prnMax : null, prnMinIntervalH: kind === 'prn' ? prnInt : null,
    startDate: start, endDate: end, prescriber: phone ? orderedByName : (fd(form, 'prescriber') || (rights.external ? `${ctx.user.firstName} ${ctx.user.lastName}` : null)),
    requiresDoubleCheck: form.get('requiresDoubleCheck') === 'on' || form.get('requiresDoubleCheck') === 'true',
    stock: stock ?? null, stockUnit: fd(form, 'stockUnit') || null, notes: fd(form, 'notes') || null, createdById: ctx.user.id,
    atc: codes.atc, gtin: codes.gtin, orderSource: source, orderedById: phone ? orderedById : null,
    confirmDueAt: confirmDueAt(source, now, phoneOrderHours(ctx.org.settings)),
  }
  const created = await db.$transaction(async (tx) => {
    if (old) await tx.medication.update({ where: { id: old.id }, data: { active: false, stoppedAt: now, stoppedById: ctx.user.id } })
    const m = await tx.medication.create({ data })
    await audit(ctx, {
      action: old ? 'medication.order.change' : 'medication.order.create', entityType: 'Medication', entityId: m.id, before: old, after: m,
      context: {
        residentId: r.id, replaces: old?.id, reason: reason || undefined, source, orderedBy: orderedByName ?? undefined, portal: rights.external || undefined,
        allergy: allergyHits.length ? { hits: allergyHits, reason: allergyReason || undefined } : undefined,
        interactions: { level: ia.level, source: ia.source, hits: ia.hits.length, reason: iaReason || undefined },
      },
    }, tx)
    return m
  })
  if (phone && orderedById) {
    await notifyT({
      orgId: ctx.org.id, userIds: [orderedById], priority: 'action', kind: 'medication.phone.pending', dutyAware: false,
      titleKey: 'meds.phone.notify.pendingTitle', bodyKey: 'meds.phone.notify.pendingBody', vars: { drug: name, name: `${r.lastName} ${r.firstName}` },
      href: await physicianHref(ctx.org.id, orderedById, r.id), groupKey: 'phone-order:' + created.id,
    })
  }
  await afterOrderChange(ctx, r, [...(old?.times ?? []), ...created.times])
  const msg = phone ? 'meds.phone.toast.created' : old ? 'meds.toast.orderChanged' : 'meds.toast.orderCreated'
  return { ok: true, message: t(msg, { drug: name, by: orderedByName ?? '' }), medId: created.id }
}

const physicianHref = async (orgId: string, userId: string, residentId: string) => {
  const u = await db.user.findFirst({ where: { id: userId, orgId }, select: { kind: true } })
  return u?.kind === 'external_physician' ? `/md/p/${residentId}#orders` : `/residents/${residentId}/meds#orders`
}

/** Verordnung absetzen (mit Begründung). */
export async function stopOrder(ctx: Actor, r: OrderResident, medId: string, reason: string): Promise<ActionResult> {
  const med = await db.medication.findFirst({ where: { id: medId, residentId: r.id } })
  if (!med) return err('common.notFound')
  if (!med.active) return err('meds.errors.orderInactive')
  if (reason.trim().length < 3) return err('meds.errors.stopReason', 'reason')
  const after = await db.medication.update({ where: { id: med.id }, data: { active: false, stoppedAt: new Date(), stoppedById: ctx.user.id } })
  await audit(ctx, { action: 'medication.order.stop', entityType: 'Medication', entityId: med.id, before: med, after, context: { residentId: r.id, reason: reason.trim() } })
  await afterOrderChange(ctx, r, med.times)
  return { ok: true, message: ctx.t('meds.toast.orderStopped', { drug: med.name }) }
}

/**
 * Ärztliche Gegenzeichnung einer telefonischen/mündlichen Verordnung (Visum). Nicht durch die Person, die sie
 * entgegengenommen hat. Erledigt die zugehörigen Benachrichtigungen.
 */
export async function confirmOrder(ctx: Actor, r: OrderResident, medId: string, canPrescribe: boolean): Promise<ActionResult> {
  const med = await db.medication.findFirst({ where: { id: medId, residentId: r.id } })
  if (!med) return err('common.notFound')
  const ok = mayConfirm({ userId: ctx.user.id, createdById: med.createdById, canPrescribe, state: confirmState(med) })
  if (!ok.ok) return err(ok.error)
  // Bedingtes Update: zwei gleichzeitige Gegenzeichnungen buchen nur einmal
  const now = new Date()
  const res = await db.medication.updateMany({ where: { id: med.id, confirmedAt: null }, data: { confirmedAt: now, confirmedById: ctx.user.id } })
  if (!res.count) return err('meds.phone.errors.notPending')
  await audit(ctx, { action: 'medication.order.confirm', entityType: 'Medication', entityId: med.id, before: { confirmedAt: null }, after: { confirmedAt: now, confirmedById: ctx.user.id }, context: { residentId: r.id, source: med.orderSource, orderedById: med.orderedById, overdue: !!med.confirmDueAt && med.confirmDueAt < now } })
  const { settleNotifications } = await import('@/lib/notify')
  await settleNotifications(ctx.org.id, 'phone-order:' + med.id)
  await emit({ orgId: ctx.org.id, type: 'medication.changed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { medicationId: med.id, action: 'confirmed' } })
  return { ok: true, message: ctx.t('meds.phone.toast.confirmed', { drug: med.name }) }
}

/** Nach jeder Änderung: Tagesaufgaben neu erzeugen und abgleichen, Echtzeit-Event. */
export async function afterOrderChange(ctx: Actor, r: { id: string; orgId: string; unitId: string; firstName: string; lastName: string }, times: string[]) {
  invalidateTaskGeneration(r.unitId)
  const today = startOfDay()
  // Zeitpunkte vor Beginn bzw. nach dem Absetzen entfallen.
  await ensureTasksForDay(r.unitId, today)
  for (const day of [today, addDays(today, 1)]) for (const time of new Set(times)) await syncSlotTask(r, day, time, ctx.user.id, ctx.t('meds.orderStoppedNote'))
  await emit({ orgId: ctx.org.id, type: 'medication.changed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id })
}
