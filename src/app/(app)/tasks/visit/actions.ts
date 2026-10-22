'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { invalidateTaskGeneration } from '@/lib/tasks'
import { addDays, addMinutes, atTime, fmtDayMonth, hm, parseDateKey, startOfDay } from '@/lib/time'
import { ORDER_KINDS, orderTask, visitSummary } from '@/lib/visit'
import { limitsFor, noteRefLabel, vitalRefLabel } from '@/lib/visit-data'
import { actionResident } from '@/app/(app)/residents/_lib/resident'

const askSchema = z.object({
  text: z.string().trim().min(3, 'visit.errors.text').max(1000),
  ref: z.string().max(80).regex(/^(|vital:[\w-]+|observation:[\w-]+)$/, 'visit.errors.ref'),
})

/** Create (PRD §49): Frage für die nächste Visite vormerken, optional mit Bezug auf Vitalwert oder Verlaufseintrag. */
export async function askVisitQuestion(residentId: string, input: { text: string; ref: string }): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.chart.write')
    const p = askSchema.parse(input)
    let ref: { refType: string; refId: string; refLabel: string } | null = null
    if (p.ref) {
      const [type, id] = p.ref.split(':') as ['vital' | 'observation', string]
      if (type === 'vital') {
        const v = await db.vitalSign.findFirst({ where: { id, residentId: r.id } })
        if (!v) return { ok: false, error: 'visit.errors.ref', field: 'ref' }
        ref = { refType: type, refId: v.id, refLabel: vitalRefLabel(ctx, v, await limitsFor(ctx, r.id)) }
      } else {
        const o = await db.observation.findFirst({ where: { id, residentId: r.id } })
        if (!o) return { ok: false, error: 'visit.errors.ref', field: 'ref' }
        ref = { refType: type, refId: o.id, refLabel: noteRefLabel(ctx, o) }
      }
    }
    const q = await db.visitQuestion.create({ data: { orgId: ctx.org.id, residentId: r.id, text: p.text, ...ref, createdById: ctx.user.id } })
    await audit(ctx, { action: 'visit.question.create', entityType: 'VisitQuestion', entityId: q.id, after: { text: q.text, refType: q.refType, refId: q.refId }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'visit.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { questionId: q.id, action: 'asked' } })
    refresh()
    return { ok: true, message: ctx.t('visit.toast.asked') }
  })
}

/** Frage zurückziehen (nicht löschen): bleibt im Audit nachvollziehbar. */
export async function withdrawVisitQuestion(residentId: string, questionId: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.chart.write')
    const q = await db.visitQuestion.findFirst({ where: { id: questionId, residentId: r.id, orgId: ctx.org.id } })
    if (!q) return { ok: false, error: 'common.notFound' }
    if (q.status !== 'open') return { ok: false, error: 'visit.errors.notOpen' }
    await db.visitQuestion.update({ where: { id: q.id }, data: { status: 'withdrawn', closedById: ctx.user.id, closedAt: new Date() } })
    await audit(ctx, { action: 'visit.question.withdraw', entityType: 'VisitQuestion', entityId: q.id, before: { status: q.status }, after: { status: 'withdrawn' }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'visit.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { questionId: q.id, action: 'withdrawn' } })
    refresh()
    return { ok: true, message: ctx.t('visit.toast.withdrawn') }
  })
}

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

/**
 * Complete (PRD §49): Visite einer Person abschliessen. In einer Transaktion: Visite, Antworten auf die Fragen,
 * Anordnungen mit je einer Aufgabe für die Pflege, Verlaufseintrag mit Zusammenfassung (Document Once, PRD §4.4)
 * und Arzttermin von heute als erledigt. Medikation wird nicht verändert – nur Aufgabe «Verordnung anpassen».
 */
export async function completeVisit(residentId: string, input: CompleteVisitInput): Promise<ActionResult<{ visitId: string; tasks: number }>> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.visit.conduct')
    const p = completeSchema.parse(input)
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
        data: { orgId: ctx.org.id, unitId: r.unitId, residentId: r.id, appointmentId: appointment?.id ?? null, physician: p.physician || null, at: now, note: p.note || null, observationId: obs.id, createdById: ctx.user.id },
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
        after: { physician: visit.physician, observationId: obs.id, answered: answered.map((q) => q.id), orders: specs.map(({ o }) => ({ kind: o.kind, text: o.text })), taskIds, appointmentId: appointment?.id ?? null },
        context: { residentId: r.id },
      }, tx)
      if (appointment) await audit(ctx, { action: 'appointment.update', entityType: 'Appointment', entityId: appointment.id, before: { done: false }, after: { done: true }, context: { residentId: r.id, visitId: visit.id } }, tx)
      return { visitId: visit.id, observationId: obs.id, taskIds }
    })
    invalidateTaskGeneration(r.unitId)
    await emit({ orgId: ctx.org.id, type: 'visit.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { visitId: result.visitId, action: 'completed' } })
    await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { observationId: result.observationId } })
    if (result.taskIds.length) await emit({ orgId: ctx.org.id, type: 'task.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { taskIds: result.taskIds, source: 'order' } })
    refresh()
    return { ok: true, message: ctx.t('visit.toast.done', { name: `${r.lastName} ${r.firstName}`, n: result.taskIds.length }), data: { visitId: result.visitId, tasks: result.taskIds.length } }
  })
}
