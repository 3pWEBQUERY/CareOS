'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCtx, residentInScope, ForbiddenError, type Ctx } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { ensureTasksForDay, invalidateTaskGeneration } from '@/lib/tasks'
import { addMinutes, atTime, dbDate, parseDateKey, startOfDay } from '@/lib/time'
import { CARE_CATEGORY, careRecurrence, isDiscipline, planSchema, sessionSchema, sessionText, type Discipline } from '@/lib/therapy'
import type { Permission } from '@/lib/permissions'

const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })
const fields = (form: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, fd(form, k)]))

async function resident(ctx: Ctx, id: string, perm: Permission) {
  const r = await residentInScope(ctx, id, 'resident.read')
  if (!r || !ctx.can(perm, { unitId: r.unitId, locationId: r.unit.locationId })) throw new ForbiddenError(perm)
  return r
}

async function planInScope(ctx: Ctx, planId: string, perm: Permission) {
  const plan = await db.therapyPlan.findFirst({ where: { id: planId, orgId: ctx.org.id } })
  if (!plan) throw new ForbiddenError(perm)
  const r = await resident(ctx, plan.residentId, perm)
  return { plan, r }
}

/** Create (PRD §49): Therapieplan mit Ziel, Frequenz, Evaluation und optional Anleitung für die Pflege (wiederkehrende Aufgabe). */
export async function createPlanAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const p = planSchema.parse(fields(form, ['residentId', 'discipline', 'goal', 'perWeek', 'sessionMin', 'startDate', 'reviewAt', 'endDate', 'careInstructions', 'careTime', 'orderId']))
    const r = await resident(ctx, p.residentId, 'therapy.manage')
    const start = parseDateKey(p.startDate)
    const review = parseDateKey(p.reviewAt)
    const end = p.endDate ? parseDateKey(p.endDate) : null
    if (start < startOfDay(addMinutes(new Date(), -60 * 24 * 30))) return err('therapy.errors.date', 'startDate')
    if (review < start) return err('therapy.errors.reviewBeforeStart', 'reviewAt')
    if (end && end < start) return err('therapy.errors.endBeforeStart', 'endDate')
    if (p.careInstructions && !p.careTime) return err('therapy.errors.careTime', 'careTime')
    const order = p.orderId ? await db.visitOrder.findFirst({ where: { id: p.orderId, residentId: r.id, kind: 'therapy' } }) : null
    if (p.orderId && !order) return err('common.notFound', 'orderId')
    const t = ctx.t
    // Pflege-Anleitung: täglich zur Uhrzeit; liegt sie heute schon zurück, beginnt die Aufgabe morgen
    const care = p.careInstructions ? careRecurrence(start, p.careTime, end) : null
    const plan = await db.$transaction(async (tx) => {
      let careTemplateId: string | null = null
      if (care) {
        const tpl = await tx.taskTemplate.create({
          data: {
            orgId: ctx.org.id, unitId: r.unitId, residentId: r.id, title: p.careInstructions.slice(0, 200), description: t('therapy.careTaskDesc', { discipline: t('therapy.disciplines.' + p.discipline), goal: p.goal }),
            category: CARE_CATEGORY[p.discipline], rhythm: care.rhythm, every: care.every, weekdays: care.weekdays, times: care.times, startDate: dbDate(care.startDate), endDate: care.endDate ? dbDate(care.endDate) : null,
            durationMin: 10, priority: 'routine', createdById: ctx.user.id,
          },
        })
        careTemplateId = tpl.id
      }
      const created = await tx.therapyPlan.create({
        data: {
          orgId: ctx.org.id, unitId: r.unitId, residentId: r.id, discipline: p.discipline, goal: p.goal, perWeek: p.perWeek, sessionMin: p.sessionMin,
          orderId: order?.id ?? null, therapistId: ctx.user.id, careInstructions: p.careInstructions || null, careTemplateId,
          startDate: dbDate(start), endDate: end ? dbDate(end) : null, reviewAt: dbDate(review), createdById: ctx.user.id,
        },
      })
      await tx.observation.create({ data: { residentId: r.id, category: 'therapy', source: 'system', authorId: ctx.user.id, text: t('therapy.obs.planCreated', { discipline: t('therapy.disciplines.' + p.discipline), goal: p.goal, n: p.perWeek, min: p.sessionMin }), structured: { kind: 'therapy-plan', planId: created.id } } })
      await audit(ctx, { action: 'therapy.plan.create', entityType: 'TherapyPlan', entityId: created.id, after: created, context: { residentId: r.id, orderId: order?.id, careTemplateId } }, tx)
      return created
    })
    if (plan.careTemplateId) {
      invalidateTaskGeneration(r.unitId)
      await ensureTasksForDay(r.unitId, startOfDay())
    }
    await emit({ orgId: ctx.org.id, type: 'careplan.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { therapyPlanId: plan.id } })
    refresh()
    return { ok: true, message: t('therapy.toast.planCreated', { name: `${r.lastName} ${r.firstName}` }) }
  })
}

const scheduleSchema = z.object({ planId: z.string().min(1).max(40), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'therapy.errors.date'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'therapy.errors.time') })

/** Einheit planen: Termin (Art «Therapie») – erscheint im Ablauf der Pflege und in der Akte. */
export async function scheduleSessionAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const p = scheduleSchema.parse(fields(form, ['planId', 'date', 'time']))
    const { plan, r } = await planInScope(ctx, p.planId, 'therapy.document')
    if (plan.status !== 'active') return err('therapy.errors.inactive')
    const at = atTime(parseDateKey(p.date), p.time)
    if (at < addMinutes(new Date(), -5)) return err('therapy.errors.past', 'time')
    const a = await db.appointment.create({ data: { residentId: r.id, at, title: ctx.t('therapy.disciplines.' + plan.discipline), kind: 'therapy', therapyPlanId: plan.id, createdById: ctx.user.id } })
    await audit(ctx, { action: 'appointment.create', entityType: 'Appointment', entityId: a.id, after: a, context: { residentId: r.id, therapyPlanId: plan.id } })
    await emit({ orgId: ctx.org.id, type: 'careplan.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { therapyPlanId: plan.id, appointmentId: a.id } })
    refresh()
    return { ok: true, message: ctx.t('therapy.toast.scheduled') }
  })
}

/** Complete (PRD §49): Einheit dokumentieren – Bericht als Verlaufseintrag (Kategorie Therapie), Termin erledigt. */
export async function documentSessionAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const p = sessionSchema.parse(fields(form, ['planId', 'appointmentId', 'outcome', 'durationMin', 'text']))
    const { plan, r } = await planInScope(ctx, p.planId, 'therapy.document')
    if (plan.status !== 'active') return err('therapy.errors.inactive')
    const appt = p.appointmentId ? await db.appointment.findFirst({ where: { id: p.appointmentId, residentId: r.id, kind: 'therapy' } }) : null
    if (p.appointmentId && !appt) return err('common.notFound')
    if (appt?.done) return err('therapy.errors.alreadyDone')
    const discipline = (isDiscipline(plan.discipline) ? plan.discipline : 'physio') as Discipline
    const text = sessionText(ctx.t, { discipline, outcome: p.outcome, durationMin: p.durationMin, text: p.text, goal: plan.goal })
    const obs = await db.$transaction(async (tx) => {
      const o = await tx.observation.create({
        data: { residentId: r.id, category: 'therapy', authorId: ctx.user.id, text, structured: { kind: 'therapy', planId: plan.id, discipline, outcome: p.outcome, durationMin: p.durationMin, appointmentId: appt?.id ?? null } },
      })
      if (appt) await tx.appointment.update({ where: { id: appt.id }, data: { done: true } })
      await audit(ctx, { action: 'therapy.session.document', entityType: 'Observation', entityId: o.id, after: { planId: plan.id, outcome: p.outcome, durationMin: p.durationMin }, context: { residentId: r.id, appointmentId: appt?.id } }, tx)
      return o
    })
    await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { observationId: obs.id, therapyPlanId: plan.id } })
    refresh()
    return { ok: true, message: ctx.t(p.outcome === 'done' ? 'therapy.toast.documented' : 'therapy.toast.cancelled', { name: `${r.lastName} ${r.firstName}` }) }
  })
}

const reviewSchema = z.object({
  planId: z.string().min(1).max(40),
  decision: z.enum(['continue', 'completed', 'stopped'], { message: 'therapy.errors.decision' }),
  outcome: z.string().trim().min(5, 'therapy.errors.outcomeText').max(2000),
  nextReview: z.string(),
})

/** Review (PRD §49): Zielevaluation – weiterführen mit neuem Termin oder abschliessen/abbrechen (Pflege-Anleitung endet). */
export async function reviewPlanAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const p = reviewSchema.parse(fields(form, ['planId', 'decision', 'outcome', 'nextReview']))
    const { plan, r } = await planInScope(ctx, p.planId, 'therapy.manage')
    if (plan.status !== 'active') return err('therapy.errors.inactive')
    let next: Date | null = null
    if (p.decision === 'continue') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.nextReview)) return err('therapy.errors.nextReview', 'nextReview')
      next = parseDateKey(p.nextReview)
      if (next <= startOfDay()) return err('therapy.errors.nextReview', 'nextReview')
    }
    const t = ctx.t
    const now = new Date()
    const after = await db.$transaction(async (tx) => {
      const u = await tx.therapyPlan.update({
        where: { id: plan.id },
        data: p.decision === 'continue'
          ? { reviewAt: dbDate(next!), outcome: p.outcome }
          : { status: p.decision, outcome: p.outcome, closedAt: now, closedById: ctx.user.id, endDate: dbDate(now) },
      })
      if (p.decision !== 'continue' && plan.careTemplateId) await tx.taskTemplate.updateMany({ where: { id: plan.careTemplateId, orgId: ctx.org.id }, data: { active: false, endDate: dbDate(now) } })
      await tx.observation.create({ data: { residentId: r.id, category: 'therapy', authorId: ctx.user.id, text: t('therapy.obs.review.' + p.decision, { discipline: t('therapy.disciplines.' + plan.discipline), text: p.outcome }), structured: { kind: 'therapy-review', planId: plan.id, decision: p.decision } } })
      await audit(ctx, { action: 'therapy.plan.review', entityType: 'TherapyPlan', entityId: plan.id, before: plan, after: u, context: { residentId: r.id, decision: p.decision } }, tx)
      return u
    })
    if (p.decision !== 'continue' && plan.careTemplateId) invalidateTaskGeneration(r.unitId)
    await emit({ orgId: ctx.org.id, type: 'careplan.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { therapyPlanId: after.id } })
    refresh()
    return { ok: true, message: t('therapy.toast.review.' + p.decision) }
  })
}
