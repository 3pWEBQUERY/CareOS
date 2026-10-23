import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { userNames } from '@/app/(app)/residents/_lib/resident'
import { hm } from '@/lib/time'
import { klvTotals, visitObservationText } from '@/lib/spitex'
import type { VisitStepData } from '@/lib/offline/types'

/**
 * Durchführung eines Einsatzes (Meine Tour): Beginn, Abschluss mit Leistungen und Notiz (Verlaufseintrag), nicht
 * angetroffen. Gemeinsame Regeln für Server Actions und Offline-Synchronisation (src/lib/offline/apply.ts):
 * Recht «spitex.document» im Einsatzgebiet, eigener Einsatz (oder Disposition), Zeitpunkt vom Gerät, Konflikte
 * ausdrücklich statt still überschrieben. Wiederholung desselben Schritts durch dieselbe Person gilt als übernommen.
 */
export type StepResult =
  | { ok: true; duplicate?: boolean; message?: string }
  | { ok: false; reason: 'visitNotFound' | 'forbidden' | 'visitClosed' | 'visitNotStarted' | 'invalid' | 'discharged'; detail?: Record<string, string> }

export async function applyVisitStep(ctx: Ctx, d: VisitStepData, at: Date, offline?: Record<string, unknown>): Promise<StepResult> {
  const v = await db.homeCareVisit.findFirst({ where: { id: d.visitId, orgId: ctx.org.id }, include: { services: { orderBy: { order: 'asc' } } } })
  if (!v) return { ok: false, reason: 'visitNotFound' }
  const unit = ctx.units.find((u) => u.id === v.unitId)
  if (!unit || !ctx.can('spitex.document', { unitId: unit.id, locationId: unit.locationId })) return { ok: false, reason: 'forbidden' }
  if (v.assigneeId !== ctx.user.id && !ctx.can('spitex.plan', { unitId: unit.id, locationId: unit.locationId })) return { ok: false, reason: 'forbidden' }
  const r = await db.resident.findFirst({ where: { id: v.residentId, orgId: ctx.org.id }, select: { id: true, unitId: true, status: true, firstName: true, lastName: true } })
  if (!r) return { ok: false, reason: 'visitNotFound' }
  if (r.status === 'discharged' || r.status === 'deceased') return { ok: false, reason: 'discharged' }
  const closedBy = async (by: string | null, when: Date | null) => {
    const names = await userNames(ctx, [by])
    return { by: names.get(by ?? '')?.short ?? '–', at: when?.toISOString() ?? '' }
  }
  const ctxInfo = { residentId: r.id, visitId: v.id, ...(offline ?? {}) }

  if (d.step === 'start') {
    if (v.status !== 'planned') {
      if (v.status === 'started' && v.startedById === ctx.user.id) return { ok: true, duplicate: true }
      return { ok: false, reason: 'visitClosed', detail: await closedBy(v.startedById ?? v.doneById, v.actualStart ?? v.actualEnd) }
    }
    const upd = await db.homeCareVisit.updateMany({ where: { id: v.id, status: 'planned' }, data: { status: 'started', actualStart: at, startedById: ctx.user.id } })
    if (!upd.count) return { ok: false, reason: 'visitClosed' }
    await audit(ctx, { action: 'spitex.visit.start', entityType: 'HomeCareVisit', entityId: v.id, before: { status: v.status }, after: { status: 'started', actualStart: at }, context: ctxInfo })
    await emit({ orgId: ctx.org.id, type: 'homecare.updated', unitId: v.unitId, residentId: r.id, actorId: ctx.user.id, payload: { visitId: v.id, status: 'started', offline: !!offline } })
    return { ok: true, message: 'spitex.toast.started' }
  }

  // Abschluss oder «nicht angetroffen»: nur aus «geplant» bzw. «begonnen»
  if (v.status === 'done' || v.status === 'missed' || v.status === 'cancelled') {
    const target = d.step === 'finish' ? 'done' : 'missed'
    if (v.status === target && v.doneById === ctx.user.id) return { ok: true, duplicate: true }
    return { ok: false, reason: 'visitClosed', detail: await closedBy(v.doneById, v.actualEnd) }
  }
  const note = (d.note ?? '').trim().slice(0, 2000)

  if (d.step === 'missed') {
    if (note.length < 3) return { ok: false, reason: 'invalid' }
    const text = ctx.t('spitex.obs.missed', { time: hm(v.plannedStart), reason: note })
    const obs = await db.$transaction(async (tx) => {
      const upd = await tx.homeCareVisit.updateMany({ where: { id: v.id, status: { in: ['planned', 'started'] } }, data: { status: 'missed', actualEnd: at, doneById: ctx.user.id, note } })
      if (!upd.count) return null
      const o = await tx.observation.create({ data: { residentId: r.id, at, category: 'care', text, authorId: ctx.user.id, structured: { kind: 'homecare-visit', visitId: v.id, outcome: 'missed', ...(offline ? { offline } : {}) } as Prisma.InputJsonValue } })
      await tx.homeCareVisit.update({ where: { id: v.id }, data: { observationId: o.id } })
      await audit(ctx, { action: 'spitex.visit.missed', entityType: 'HomeCareVisit', entityId: v.id, before: { status: v.status }, after: { status: 'missed', note }, context: ctxInfo }, tx)
      return o
    })
    if (!obs) return { ok: false, reason: 'visitClosed' }
    await emitDone(ctx, v.unitId, r.id, v.id, obs.id, 'missed', !!offline)
    return { ok: true, message: 'spitex.toast.missed' }
  }

  if (v.status !== 'started' || !v.actualStart) return { ok: false, reason: 'visitNotStarted' }
  const byId = new Map((d.services ?? []).map((s) => [s.id, s]))
  if ([...byId.keys()].some((id) => !v.services.some((s) => s.id === id))) return { ok: false, reason: 'invalid' }
  const services = v.services.map((s) => {
    const x = byId.get(s.id)
    const done = !!x?.done
    const min = x?.minutes != null && Number.isFinite(x.minutes) ? Math.round(x.minutes) : null
    return { ...s, done, actualMin: done ? (min != null && min >= 0 && min <= 240 ? min : s.plannedMin) : null }
  })
  const end = at > v.actualStart ? at : v.actualStart
  const totals = klvTotals([{ status: 'done', services }])
  const text = visitObservationText(ctx.t, { start: v.actualStart, end, services, note })
  const obs = await db.$transaction(async (tx) => {
    const upd = await tx.homeCareVisit.updateMany({ where: { id: v.id, status: 'started' }, data: { status: 'done', actualEnd: end, doneById: ctx.user.id, note: note || v.note } })
    if (!upd.count) return null
    for (const s of services) await tx.homeCareService.update({ where: { id: s.id }, data: { done: s.done, actualMin: s.actualMin } })
    const o = await tx.observation.create({
      data: {
        residentId: r.id, at: end, category: 'care', text, authorId: ctx.user.id,
        structured: { kind: 'homecare-visit', visitId: v.id, outcome: 'done', klv: { a: totals.a, b: totals.b, c: totals.c }, ...(offline ? { offline } : {}) } as Prisma.InputJsonValue,
      },
    })
    await tx.homeCareVisit.update({ where: { id: v.id }, data: { observationId: o.id } })
    await audit(ctx, {
      action: 'spitex.visit.finish', entityType: 'HomeCareVisit', entityId: v.id, before: { status: v.status },
      after: { status: 'done', actualStart: v.actualStart, actualEnd: end, services: services.map((s) => ({ id: s.id, klv: s.klv, done: s.done, actualMin: s.actualMin })) }, context: ctxInfo,
    }, tx)
    return o
  })
  if (!obs) return { ok: false, reason: 'visitClosed' }
  await emitDone(ctx, v.unitId, r.id, v.id, obs.id, 'done', !!offline)
  return { ok: true, message: 'spitex.toast.finished' }
}

async function emitDone(ctx: Ctx, unitId: string, residentId: string, visitId: string, observationId: string, status: string, offline: boolean) {
  await emit({ orgId: ctx.org.id, type: 'observation.created', unitId, residentId, actorId: ctx.user.id, payload: { observationId, homeCareVisitId: visitId, offline } })
  await emit({ orgId: ctx.org.id, type: 'homecare.updated', unitId, residentId, actorId: ctx.user.id, payload: { visitId, status, offline } })
}
