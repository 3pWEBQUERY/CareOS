'use server'

import { refresh } from 'next/cache'
import type { AdministrationStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { assertCan, getCtx, residentInScope, type Ctx } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { hasPermission, type Grant } from '@/lib/permissions'
import { verifyPassword } from '@/lib/auth/password'
import { rateLimit } from '@/lib/rate-limit'
import { addDays, addMinutes, atTime, hm, parseDateKey, startOfDay } from '@/lib/time'
import { doseUnits, EFFECT_CHECK_MIN, hasDose, medAppliesAt, prnStatus, slotKey, syncSlotTask } from '@/lib/medication'
import { confirmOrder, gateDto, interactionGate, saveOrder, stopOrder, type GateDto } from '@/lib/medication-orders'
import { parseCodes } from '@/lib/medication-codes'

type Resident = NonNullable<Awaited<ReturnType<typeof residentInScope>>>

async function loadMed(ctx: Ctx, medicationId: string, perm: 'resident.medication.administer' | 'resident.medication.edit') {
  const med = await db.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw new Error('not_found')
  const r = await residentInScope(ctx, med.residentId, perm)
  if (!r) throw new Error('not_found')
  assertCan(ctx, perm, { unitId: r.unitId, locationId: r.unit.locationId })
  return { med, r }
}

const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })

/** Vier-Augen-Prinzip: zweite Person bestätigt mit eigenem Passwort (PRD §13.1). */
async function verifyChecker(ctx: Ctx, r: Resident, form: FormData): Promise<{ ok: true; id: string } | { ok: false; res: ActionResult }> {
  const checkerId = fd(form, 'checkerId')
  const pw = typeof form.get('checkerPassword') === 'string' ? String(form.get('checkerPassword')) : ''
  if (!checkerId) return { ok: false, res: err('meds.errors.checkerRequired', 'checkerId') }
  if (checkerId === ctx.user.id) return { ok: false, res: err('meds.errors.checkerSelf', 'checkerId') }
  if (!pw) return { ok: false, res: err('meds.errors.checkerPassword', 'checkerPassword') }
  const limit = await rateLimit('doublecheck:' + ctx.user.id, 8, 10 * 60_000)
  if (!limit.ok) return { ok: false, res: err('meds.errors.tooManyAttempts') }
  const u = await db.user.findFirst({ where: { id: checkerId, orgId: ctx.org.id, active: true }, include: { roles: { include: { role: true } } } })
  const grants: Grant[] = (u?.roles ?? []).map((a) => ({ permissions: a.role.permissions, unitId: a.unitId, locationId: a.locationId }))
  if (!u || !hasPermission(grants, 'resident.medication.doublecheck', { unitId: r.unitId, locationId: r.unit.locationId })) {
    return { ok: false, res: err('meds.errors.checkerNoPermission', 'checkerId') }
  }
  if (!(await verifyPassword(u.passwordHash, pw))) {
    await audit(ctx, { action: 'medication.doublecheck.failed', entityType: 'User', entityId: u.id, context: { residentId: r.id } })
    return { ok: false, res: err('meds.errors.checkerPassword', 'checkerPassword') }
  }
  return { ok: true, id: u.id }
}

const STATUSES = ['open', 'given', 'refused', 'omitted', 'held'] as const

/**
 * Dokumentiert den Zustand einer geplanten Dosis. Bestehende Abgabe wird storniert (nie geändert),
 * dann ein neuer Eintrag erstellt. `expectedId` erkennt gleichzeitige Änderungen (PRD §32 Konflikterkennung).
 */
export async function setDoseAction(form: FormData): Promise<ActionResult<{ adminId: string }>> {
  return run<{ adminId: string }>(async () => {
    const ctx = await getCtx()
    const { t } = ctx
    const { med, r } = await loadMed(ctx, fd(form, 'medicationId'), 'resident.medication.administer')
    const status = fd(form, 'status') as (typeof STATUSES)[number]
    if (!STATUSES.includes(status)) return { ok: false, error: 'common.genericError' }
    const time = fd(form, 'time')
    const day = parseDateKey(fd(form, 'day'))
    const today = startOfDay()
    if (day > today || day < addDays(today, -1)) return err('meds.errors.dayLocked')
    const idx = med.times.indexOf(time)
    const at = atTime(day, time)
    const current = await db.medicationAdministration.findFirst({ where: { medicationId: med.id, scheduledFor: at, voidedAt: null }, orderBy: { at: 'desc' } })
    if ((current?.id ?? '') !== fd(form, 'expectedId')) return err('meds.errors.conflict')
    if (!current && (idx < 0 || !hasDose(med.doses[idx]) || !medAppliesAt(med, at))) return err('meds.errors.notScheduled')
    if (status === 'open' && !current) return { ok: true }
    if (current && current.status === status) return { ok: true }
    const reason = fd(form, 'reason')
    if ((status === 'omitted' || status === 'held') && reason.length < 3) return err('meds.errors.reasonRequired', 'reason')

    let checkedById: string | null = null
    if (status === 'given' && med.requiresDoubleCheck) {
      const c = await verifyChecker(ctx, r, form)
      if (!c.ok) return c.res
      checkedById = c.id
    }
    const dose = (idx >= 0 ? med.doses[idx] : current?.dose) ?? ''
    const slot = t('meds.slots.' + slotKey(time))

    const created = await db.$transaction(async (tx) => {
      let stockDelta = 0
      if (current) {
        await tx.medicationAdministration.update({ where: { id: current.id }, data: { voidedAt: new Date(), voidedById: ctx.user.id } })
        if (current.status === 'given') stockDelta += doseUnits(current.dose) ?? 0
      }
      let row = null
      if (status !== 'open') {
        row = await tx.medicationAdministration.create({
          data: { medicationId: med.id, residentId: r.id, scheduledFor: at, status: status as AdministrationStatus, dose, byId: ctx.user.id, checkedById, note: reason || null },
        })
        if (status === 'given') stockDelta -= doseUnits(dose) ?? 0
        if (status === 'refused') {
          await tx.observation.create({
            data: { residentId: r.id, category: 'observation', source: 'system', authorId: ctx.user.id, text: t('meds.obs.refused', { drug: med.name, slot, time }) + (reason ? ' ' + reason : '') },
          })
        }
      }
      if (stockDelta && med.stock != null) await tx.medication.update({ where: { id: med.id }, data: { stock: Math.max(0, med.stock + stockDelta) } })
      await audit(ctx, {
        action: status === 'open' ? 'medication.administration.void' : 'medication.administration.record',
        entityType: 'MedicationAdministration',
        entityId: row?.id ?? current?.id,
        before: current,
        after: row,
        context: { residentId: r.id, medicationId: med.id, scheduledFor: at.toISOString(), stockDelta },
      }, tx)
      return row
    })

    await emit({ orgId: ctx.org.id, type: 'medication.administered', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { medicationId: med.id, status, scheduledFor: at.toISOString() } })
    const change = await syncSlotTask(r, day, time, ctx.user.id, t('meds.orderStoppedNote'))
    if (change === 'completed' || change === 'skipped') await emit({ orgId: ctx.org.id, type: 'task.completed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id })
    if (change === 'reopened') await emit({ orgId: ctx.org.id, type: 'task.reopened', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id })
    refresh()
    // adminId erlaubt das Rückgängigmachen direkt aus dem Toast (Storno mit Konflikterkennung).
    return { ok: true, message: t('meds.toast.' + status, { drug: med.name, slot }), data: { adminId: created?.id ?? '' } }
  })
}

/** Reservemedikation abgeben: Abgabe + Verlaufseintrag + Aufgabe Wirkungskontrolle (+45 Min.). */
export async function givePrnAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { t } = ctx
    const { med, r } = await loadMed(ctx, fd(form, 'medicationId'), 'resident.medication.administer')
    const now = new Date()
    if (med.kind !== 'prn' || !medAppliesAt(med, now)) return err('meds.errors.notScheduled')
    const dose = fd(form, 'dose') || med.prnDose || ''
    if (!dose) return err('meds.errors.dose', 'dose')
    const reason = fd(form, 'reason')
    if (reason.length < 3) return err('meds.errors.prnReason', 'reason')
    const recent = await db.medicationAdministration.findMany({ where: { medicationId: med.id, scheduledFor: null, at: { gte: addDays(now, -2) } } })
    const st = prnStatus(med, recent, now)
    if (st.full) return err('meds.errors.prnMax')
    const override = fd(form, 'override')
    if (st.nextAllowed && override.length < 3) return err('meds.errors.prnInterval', 'override')
    let checkedById: string | null = null
    if (med.requiresDoubleCheck) {
      const c = await verifyChecker(ctx, r, form)
      if (!c.ok) return c.res
      checkedById = c.id
    }
    const note = [reason, st.nextAllowed ? t('meds.prn.overrideNote', { reason: override }) : ''].filter(Boolean).join(' · ')
    const res = await db.$transaction(async (tx) => {
      const a = await tx.medicationAdministration.create({
        data: { medicationId: med.id, residentId: r.id, scheduledFor: null, status: 'given', dose, byId: ctx.user.id, checkedById, note },
      })
      const units = doseUnits(dose)
      if (units && med.stock != null) await tx.medication.update({ where: { id: med.id }, data: { stock: Math.max(0, med.stock - units) } })
      await tx.observation.create({
        data: { residentId: r.id, category: 'care', source: 'system', authorId: ctx.user.id, text: t('meds.obs.prn', { drug: med.name, dose, reason }) },
      })
      const task = await tx.task.create({
        data: {
          orgId: r.orgId, unitId: r.unitId, residentId: r.id, title: t('meds.prn.effectTask', { drug: med.name }), category: 'Medikation',
          dueAt: addMinutes(now, EFFECT_CHECK_MIN), durationMin: 5, priority: 'important', source: 'medication', sourceId: 'prn:' + a.id, createdById: ctx.user.id,
          description: t('meds.prn.effectTaskHint', { dose, time: hm(now) }),
        },
      })
      await audit(ctx, { action: 'medication.prn.record', entityType: 'MedicationAdministration', entityId: a.id, after: a, context: { residentId: r.id, medicationId: med.id, taskId: task.id, overrideInterval: !!st.nextAllowed } }, tx)
      return { a, task }
    })
    await emit({ orgId: ctx.org.id, type: 'medication.administered', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { medicationId: med.id, status: 'given', prn: true } })
    await emit({ orgId: ctx.org.id, type: 'task.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { taskId: res.task.id } })
    refresh()
    return { ok: true, message: t('meds.toast.prn', { drug: med.name, time: hm(res.task.dueAt) }) }
  }) as Promise<ActionResult>
}

/** Wirkungskontrolle nach Reserve: effectAt/effectNote setzen, Aufgabe erledigen. */
export async function recordEffectAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { t } = ctx
    const a = await db.medicationAdministration.findUnique({ where: { id: fd(form, 'adminId') }, include: { medication: true } })
    if (!a || a.voidedAt) return err('common.notFound')
    const { r } = await loadMed(ctx, a.medicationId, 'resident.medication.administer')
    if (a.effectAt) return err('meds.errors.effectDone')
    const effect = fd(form, 'effect')
    if (!['effective', 'partial', 'none'].includes(effect)) return err('meds.errors.effectRequired', 'effect')
    const note = fd(form, 'note')
    if (effect !== 'effective' && note.length < 3) return err('meds.errors.effectNote', 'note')
    const effectNote = t('meds.effect.' + effect) + (note ? ': ' + note : '')
    const updated = await db.medicationAdministration.update({ where: { id: a.id }, data: { effectAt: new Date(), effectNote } })
    const task = await db.task.findFirst({ where: { source: 'medication', sourceId: 'prn:' + a.id } })
    if (task && task.status !== 'done') await db.task.update({ where: { id: task.id }, data: { status: 'done', completedById: ctx.user.id, completedAt: new Date(), note: effectNote } })
    if (effect !== 'effective') {
      await db.observation.create({ data: { residentId: r.id, category: 'observation', source: 'system', authorId: ctx.user.id, text: t('meds.obs.effect', { drug: a.medication.name, effect: effectNote }) } })
    }
    await audit(ctx, { action: 'medication.prn.effect', entityType: 'MedicationAdministration', entityId: a.id, before: { effectAt: null, effectNote: null }, after: { effectAt: updated.effectAt, effectNote }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'medication.administered', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { effect } })
    if (task) await emit({ orgId: ctx.org.id, type: 'task.completed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id })
    refresh()
    return { ok: true, message: t('meds.toast.effect') }
  }) as Promise<ActionResult>
}

/** Fehlerfassung einer Reserveabgabe stornieren (bleibt im Protokoll sichtbar). */
export async function voidPrnAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const a = await db.medicationAdministration.findUnique({ where: { id: fd(form, 'adminId') }, include: { medication: true } })
    if (!a || a.voidedAt || a.scheduledFor) return err('common.notFound')
    const { r } = await loadMed(ctx, a.medicationId, 'resident.medication.administer')
    const reason = fd(form, 'reason')
    if (reason.length < 3) return err('meds.errors.reasonRequired', 'reason')
    await db.$transaction(async (tx) => {
      await tx.medicationAdministration.update({ where: { id: a.id }, data: { voidedAt: new Date(), voidedById: ctx.user.id } })
      const units = doseUnits(a.dose)
      if (units && a.medication.stock != null) await tx.medication.update({ where: { id: a.medicationId }, data: { stock: a.medication.stock + units } })
      await tx.task.updateMany({ where: { source: 'medication', sourceId: 'prn:' + a.id, status: { in: ['planned', 'ready', 'in_progress', 'escalated'] } }, data: { status: 'skipped', completedById: ctx.user.id, completedAt: new Date(), note: reason } })
      await audit(ctx, { action: 'medication.administration.void', entityType: 'MedicationAdministration', entityId: a.id, before: a, context: { residentId: r.id, reason } }, tx)
    })
    await emit({ orgId: ctx.org.id, type: 'medication.administered', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { voided: a.id } })
    refresh()
    return { ok: true, message: ctx.t('meds.toast.voided') }
  }) as Promise<ActionResult>
}

// ───────── Verordnungen ─────────
// Logik gemeinsam mit dem Ärzteportal in src/lib/medication-orders.ts

async function orderResident(ctx: Ctx, residentId: string) {
  const r = await residentInScope(ctx, residentId, 'resident.medication.read')
  if (!r) throw new Error('not_found')
  const scope = { unitId: r.unitId, locationId: r.unit.locationId }
  return { r, canPrescribe: ctx.can('resident.medication.edit', scope), canPhone: ctx.can('resident.medication.phone_order', scope) }
}

/** Neue Verordnung oder Änderung (ärztlich) bzw. telefonische/mündliche Anordnung (Pflege, Gegenzeichnung nötig). */
export async function saveOrderAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { r, canPrescribe, canPhone } = await orderResident(ctx, fd(form, 'residentId'))
    if (!canPrescribe && !canPhone) assertCan(ctx, 'resident.medication.edit', { unitId: r.unitId, locationId: r.unit.locationId })
    const res = await saveOrder(ctx, r, form, { canPrescribe, canPhone })
    if (res.ok) refresh()
    return res.ok ? { ok: true, message: res.message } : res
  }) as Promise<ActionResult>
}

export async function stopOrderAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { med, r } = await loadMed(ctx, fd(form, 'id'), 'resident.medication.edit')
    const res = await stopOrder(ctx, r, med.id, fd(form, 'reason'))
    if (res.ok) refresh()
    return res
  }) as Promise<ActionResult>
}

/** Ärztliche Gegenzeichnung (Visum) einer telefonischen/mündlichen Verordnung. */
export async function confirmOrderAction(medicationId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { med, r } = await loadMed(ctx, medicationId, 'resident.medication.edit')
    const res = await confirmOrder(ctx, r, med.id, true)
    if (res.ok) refresh()
    return res
  }) as Promise<ActionResult>
}

/** Interaktionsprüfung im Verordnungsdialog, bevor gespeichert wird (der Server prüft beim Speichern erneut). */
export async function previewInteractionsAction(residentId: string, draft: { name: string; atc: string; gtin: string; replacesId: string | null }): Promise<ActionResult<GateDto>> {
  return run<GateDto>(async () => {
    const ctx = await getCtx()
    const { r, canPrescribe, canPhone } = await orderResident(ctx, residentId)
    if (!canPrescribe && !canPhone) return { ok: false, error: 'common.notAllowed' }
    const name = String(draft.name ?? '').trim().slice(0, 200)
    if (name.length < 2) return { ok: true, data: { level: 'clear', source: null, needsReason: false, hits: [] } }
    const codes = parseCodes({ atc: String(draft.atc ?? ''), gtin: String(draft.gtin ?? '') })
    const g = await interactionGate(ctx.org.id, r.id, { name, atc: codes.atc, gtin: codes.gtin }, typeof draft.replacesId === 'string' ? draft.replacesId : null, ctx.locale)
    return { ok: true, data: gateDto(g) }
  })
}
