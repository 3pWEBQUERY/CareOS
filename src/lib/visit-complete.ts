import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { ActionResult } from '@/lib/action'
import type { Ctx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { invalidateTaskGeneration } from '@/lib/tasks'
import { addDays, addMinutes, atTime, fmtDayMonth, hm, parseDateKey, startOfDay } from '@/lib/time'
import { ORDER_KINDS, orderTask, visitSummary } from '@/lib/visit'

/** Visite abschliessen – gemeinsam für die Stationsapp (/tasks/visit) und das Ärzteportal (/md). */
type Actor = Pick<Ctx, 'org' | 'user' | 't' | 'locale' | 'sessionId' | 'ip' | 'userAgent'>
type VisitResident = { id: string; unitId: string; firstName: string; lastName: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const completeSchema = z.object({
  physician: z.string().trim().max(120),
  note: z.string().trim().max(4000),
  appointmentId: z.string().max(40).nullable(),
  answers: z.array(z.object({ id: z.string().max(40), answer: z.string().trim().max(2000) })).max(50),
  orders: z.array(z.object({
    kind: z.enum(ORDER_KINDS),
    text: z.string().trim().min(2, 'visit.errors.orderText').max(500, 'visit.errors.orderText'),
    date: z.string().refine((v) => !v || DATE.test(v), 'visit.errors.due'),
    time: z.string().refine((v) => !v || TIME.test(v), 'visit.errors.due'),
    questionId: z.string().max(40).nullable(),
  })).max(20, 'visit.errors.tooMany'),
})
export type CompleteVisitInput = z.input<typeof completeSchema>
export type VisitActor = { physicianId: string | null; physicianName?: string | null; portal?: boolean }

/**
 * Complete (PRD §49): Visite einer Person abschliessen. In einer Transaktion: Visite, Antworten auf die Fragen,
 * Anordnungen mit je einer Aufgabe für die Pflege, Verlaufseintrag mit Zusammenfassung (Document Once, PRD §4.4)
 * und Arzttermin von heute als erledigt. Medikation wird nicht verändert – nur Aufgabe «Verordnung anpassen».
 */
export async function completeVisitCore(ctx: Actor, r: VisitResident, input: CompleteVisitInput, who: VisitActor): Promise<ActionResult<{ visitId: string; tasks: number }>> {
  {
    const p = completeSchema.parse(input)
    // Im Ärzteportal steht die Ärztin/der Arzt fest (Konto), sonst Freitext der Erfassung
    if (who.physicianName) p.physician = who.physicianName
    const now = new Date()
    const orders: ((typeof p.orders)[number] & { dueAt: Date | null })[] = []
    for (const [i, o] of p.orders.entries()) {
      // Datum ohne Uhrzeit: 08:00; Uhrzeit ohne Datum: heute
      const dueAt = o.date || o.time ? atTime(o.date ? parseDateKey(o.date) : startOfDay(now), o.time || '08:00') : null
      if (dueAt && dueAt < addMinutes(now, -5)) return { ok: false, error: 'visit.errors.duePast', field: `orders.${i}.${o.time || !o.date ? 'time' : 'date'}` }
      orders.push({ ...o, dueAt })
    }
    const day = startOfDay(now)
    const [questions, appts] = await Promise.all([
      db.visitQuestion.findMany({ where: { orgId: ctx.org.id, residentId: r.id, status: 'open', id: { in: p.answers.map((a) => a.id) } } }),
      db.appointment.findMany({ where: { residentId: r.id, kind: 'physician', done: false, at: { gte: day, lt: addDays(day, 1) } } }),
    ])
    if (questions.length !== p.answers.length) return { ok: false, error: 'visit.errors.notOpen' }
    const qIds = new Set(questions.map((q) => q.id))
    for (const o of orders) if (o.questionId && !qIds.has(o.questionId)) return { ok: false, error: 'visit.errors.notOpen' }
    const answerOf = (id: string) => p.answers.find((a) => a.id === id)?.answer || null
    const specs = orders.map((o) => ({ o, task: orderTask(o, now, p.physician || null) }))
    const when = (d: Date) => fmtDayMonth(d, ctx.locale) + ' ' + hm(d)
    const summary = visitSummary(ctx.t, {
      physician: p.physician || null,
      answers: questions.map((q) => ({ question: q.text, answer: answerOf(q.id) })),
      orders: specs.map(({ o, task }) => ({ kind: o.kind, text: o.text, dueAt: task.dueAt })),
      note: p.note || null,
    }, when)
    const appointment = (p.appointmentId && appts.find((a) => a.id === p.appointmentId)) || appts[0] || null

    const result = await db.$transaction(async (tx) => {
      const obs = await tx.observation.create({ data: { residentId: r.id, at: now, category: 'physician', text: summary, authorId: ctx.user.id, source: 'manual' } })
      const visit = await tx.visit.create({
        data: { orgId: ctx.org.id, unitId: r.unitId, residentId: r.id, appointmentId: appointment?.id ?? null, physician: p.physician || null, physicianId: who.physicianId, at: now, note: p.note || null, observationId: obs.id, createdById: ctx.user.id },
      })
      const answered = questions.filter((q) => answerOf(q.id))
      for (const q of answered) await tx.visitQuestion.update({ where: { id: q.id }, data: { status: 'answered', answer: answerOf(q.id), visitId: visit.id, closedById: ctx.user.id, closedAt: now } })
      const taskIds: string[] = []
      for (const { o, task } of specs) {
        const order = await tx.visitOrder.create({ data: { visitId: visit.id, residentId: r.id, kind: o.kind, text: o.text, dueAt: task.dueAt, questionId: o.questionId } })
        const k = await tx.task.create({
          data: {
            orgId: ctx.org.id, unitId: r.unitId, residentId: r.id, title: task.title, description: task.description, category: task.category,
            dueAt: task.dueAt, durationMin: task.durationMin, priority: task.priority, status: 'planned', source: 'order', sourceId: order.id, createdById: ctx.user.id,
          },
        })
        await tx.visitOrder.update({ where: { id: order.id }, data: { taskId: k.id } })
        taskIds.push(k.id)
      }
      if (appointment) await tx.appointment.update({ where: { id: appointment.id }, data: { done: true } })
      await audit(ctx, {
        action: 'visit.complete', entityType: 'Visit', entityId: visit.id,
        after: { physician: visit.physician, physicianId: who.physicianId, portal: who.portal || undefined, observationId: obs.id, answered: answered.map((q) => q.id), orders: specs.map(({ o }) => ({ kind: o.kind, text: o.text })), taskIds, appointmentId: appointment?.id ?? null },
        context: { residentId: r.id },
      }, tx)
      if (appointment) await audit(ctx, { action: 'appointment.update', entityType: 'Appointment', entityId: appointment.id, before: { done: false }, after: { done: true }, context: { residentId: r.id, visitId: visit.id } }, tx)
      return { visitId: visit.id, observationId: obs.id, taskIds }
    })
    invalidateTaskGeneration(r.unitId)
    await emit({ orgId: ctx.org.id, type: 'visit.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { visitId: result.visitId, action: 'completed' } })
    await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { observationId: result.observationId } })
    if (result.taskIds.length) await emit({ orgId: ctx.org.id, type: 'task.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { taskIds: result.taskIds, source: 'order' } })
    return { ok: true, message: ctx.t('visit.toast.done', { name: `${r.lastName} ${r.firstName}`, n: result.taskIds.length }), data: { visitId: result.visitId, tasks: result.taskIds.length } }
  }
}
