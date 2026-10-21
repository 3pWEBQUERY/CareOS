'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, fd, fdNum, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { taskTitle } from '@/lib/task-title'
import { atTime } from '@/lib/time'
import { actionResident } from '../../_lib/resident'

const pick = (k: { status: string; completedById: string | null; completedAt: Date | null; note: string | null }) => ({
  status: k.status, completedById: k.completedById, completedAt: k.completedAt, note: k.note,
})

async function loadTask(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } })
  if (!task?.residentId) throw new Error('not_found')
  const { ctx, r } = await actionResident(task.residentId, 'task.complete')
  if (task.orgId !== ctx.org.id) throw new Error('not_found')
  return { ctx, r, task }
}

/** Checkbox im Tagesplan: erledigt / wieder offen. Medikationsaufgaben werden nur über die Medikation quittiert. */
export async function toggleTask(taskId: string, done: boolean): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r, task } = await loadTask(taskId)
    if (task.source === 'medication') return { ok: false, error: 'chart.day.medOnly' }
    const data = done
      ? { status: 'done' as const, completedById: ctx.user.id, completedAt: new Date() }
      : { status: 'planned' as const, completedById: null, completedAt: null, note: null }
    const after = await db.task.update({ where: { id: task.id }, data })
    await audit(ctx, { action: done ? 'task.complete' : 'task.reopen', entityType: 'Task', entityId: task.id, before: pick(task), after: pick(after), context: { residentId: r.id, title: task.title } })
    await emit({ orgId: ctx.org.id, type: done ? 'task.completed' : 'task.reopened', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { taskId: task.id, status: after.status } })
    refresh()
  })
}

const docSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(['done', 'partial', 'skipped'], { message: 'chart.day.errors.status' }),
  reason: z.string().max(2000),
  note: z.string().max(4000),
})

/** Fokus-Dokumentation aus der Aufgabe (PRD §10.2): ✓ / △ / ✕, Begründung, optionale Besonderheit. */
export async function documentTask(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const input = docSchema.parse({ taskId: fd(form, 'taskId'), status: fd(form, 'status'), reason: fd(form, 'reason'), note: fd(form, 'note') })
    if (input.status !== 'done' && input.reason.length < 3) return { ok: false, error: 'chart.day.errors.reason', field: 'reason' }
    const { ctx, r, task } = await loadTask(input.taskId)
    if (task.source === 'medication') return { ok: false, error: 'chart.day.medOnly' }
    const { t } = ctx
    const title = taskTitle(t, task)
    const noteText = [input.status !== 'done' ? input.reason : '', input.note].filter(Boolean).join(' – ') || null
    const after = await db.task.update({
      where: { id: task.id },
      data: { status: input.status, completedById: ctx.user.id, completedAt: new Date(), note: noteText },
    })
    await audit(ctx, { action: 'task.document', entityType: 'Task', entityId: task.id, before: pick(task), after: pick(after), context: { residentId: r.id, title: task.title } })
    if (input.status !== 'done' || input.note) {
      const parts = [`${title}: ${t('chart.day.statusText.' + input.status)}.`]
      if (input.status !== 'done') parts.push(t('chart.day.reasonPrefix') + ' ' + input.reason)
      if (input.note) parts.push(input.note)
      const obs = await db.observation.create({
        data: { residentId: r.id, category: 'care', text: parts.join(' '), authorId: ctx.user.id, source: 'task', taskId: task.id },
      })
      await audit(ctx, { action: 'observation.create', entityType: 'Observation', entityId: obs.id, after: { category: obs.category, text: obs.text, taskId: task.id }, context: { residentId: r.id } })
      await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { observationId: obs.id } })
    }
    await emit({ orgId: ctx.org.id, type: 'task.completed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { taskId: task.id, status: after.status } })
    refresh()
  })
}

const newSchema = z.object({
  title: z.string().min(2, 'chart.day.errors.title').max(200),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'chart.day.errors.time'),
  category: z.string().min(1).max(60),
  priority: z.enum(['routine', 'important', 'critical']),
  description: z.string().max(2000),
})

/** Manuelle Aufgabe für diese Person (heute). */
export async function createTask(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'task.manage')
    const input = newSchema.parse({ title: fd(form, 'title'), time: fd(form, 'time'), category: fd(form, 'category'), priority: fd(form, 'priority') || 'routine', description: fd(form, 'description') })
    const dur = fdNum(form, 'durationMin')
    if (dur != null && (!Number.isInteger(dur) || dur < 1 || dur > 480)) return { ok: false, error: 'chart.day.errors.duration', field: 'durationMin' }
    const task = await db.task.create({
      data: {
        orgId: ctx.org.id, unitId: r.unitId, residentId: r.id, title: input.title, description: input.description || null, category: input.category,
        dueAt: atTime(new Date(), input.time), durationMin: dur ?? 10, priority: input.priority, source: 'manual', createdById: ctx.user.id,
      },
    })
    await audit(ctx, { action: 'task.create', entityType: 'Task', entityId: task.id, after: { title: task.title, dueAt: task.dueAt, category: task.category, priority: task.priority }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'task.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { taskId: task.id } })
    refresh()
  })
}
