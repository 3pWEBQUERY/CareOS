'use server'

import { refresh } from 'next/cache'
import type { Priority } from '@prisma/client'
import { db } from '@/lib/db'
import { assertCan, getCtx, residentInScope, type Ctx } from '@/lib/context'
import { run, fd, fdNum, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify, usersWithPermission } from '@/lib/notify'
import { taskTitle } from '@/lib/task-title'
import { isClosed } from '@/lib/tasks'
import { atTime, parseDateKey } from '@/lib/time'

const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })

async function loadTask(ctx: Ctx, id: string, perm: 'task.complete' | 'task.manage') {
  const task = await db.task.findFirst({ where: { id, orgId: ctx.org.id, unitId: { in: ctx.unitIds } }, include: { resident: { include: { room: true } } } })
  if (!task) throw new Error('not_found')
  const unit = ctx.units.find((u) => u.id === task.unitId)
  assertCan(ctx, perm, { unitId: task.unitId, locationId: unit?.locationId })
  return task
}
const who = (task: Awaited<ReturnType<typeof loadTask>>) => (task.resident ? `${task.resident.lastName} ${task.resident.firstName}${task.resident.room ? ' · ' + task.resident.room.number : ''}` : '')
const snapshot = (t: { status: string; assigneeId: string | null; completedById: string | null; completedAt: Date | null; note: string | null }) => ({ status: t.status, assigneeId: t.assigneeId, completedById: t.completedById, completedAt: t.completedAt, note: t.note })
const isMedSlot = (t: { source: string; title: string }) => t.source === 'medication' && t.title === 'medication.slot'

/** Create (PRD §49): manuelle Aufgabe mit optionaler Person, Zuständigkeit und Priorität. */
export async function createTaskAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { t } = ctx
    const residentId = fd(form, 'residentId')
    let unitId = ctx.unit?.id ?? null
    if (residentId) {
      const r = await residentInScope(ctx, residentId)
      if (!r) return err('common.notFound', 'residentId')
      unitId = r.unitId
    }
    if (!unitId) return err('tasks.errors.noUnit')
    const unit = ctx.units.find((u) => u.id === unitId)
    assertCan(ctx, 'task.manage', { unitId, locationId: unit?.locationId })
    const title = fd(form, 'title')
    if (title.length < 2) return err('tasks.errors.title', 'title')
    const date = fd(form, 'date')
    const time = fd(form, 'time')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('tasks.errors.date', 'date')
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return err('tasks.errors.time', 'time')
    const dueAt = atTime(parseDateKey(date), time)
    const dur = fdNum(form, 'durationMin') ?? 10
    if (Number.isNaN(dur) || dur < 1 || dur > 480) return err('tasks.errors.duration', 'durationMin')
    const priority = (['critical', 'important', 'routine'].includes(fd(form, 'priority')) ? fd(form, 'priority') : 'routine') as Priority
    const assigneeId = fd(form, 'assigneeId') || null
    if (assigneeId) {
      const ok = (await usersWithPermission(ctx.org.id, 'task.complete', unitId)).includes(assigneeId)
      if (!ok) return err('tasks.errors.assignee', 'assigneeId')
    }
    const task = await db.task.create({
      data: {
        orgId: ctx.org.id, unitId, residentId: residentId || null, title, description: fd(form, 'description') || null, category: fd(form, 'category') || t('tasks.categoryDefault'),
        dueAt, durationMin: Math.round(dur), priority, status: 'planned', source: 'manual', assigneeId, createdById: ctx.user.id,
      },
    })
    await audit(ctx, { action: 'task.create', entityType: 'Task', entityId: task.id, after: task, context: { residentId: task.residentId } })
    await emit({ orgId: ctx.org.id, type: 'task.created', unitId, residentId: task.residentId, actorId: ctx.user.id, payload: { taskId: task.id } })
    if (assigneeId && assigneeId !== ctx.user.id) {
      await notify({ orgId: ctx.org.id, userIds: [assigneeId], priority: priority === 'critical' ? 'critical' : 'action', kind: 'task', title: t('tasks.notify.assigned', { title }), body: `${hmOf(dueAt)}`, href: '/tasks?f=mine', groupKey: 'task-assigned:' + assigneeId })
    }
    refresh()
    return { ok: true, message: t('tasks.toast.created') }
  }) as Promise<ActionResult>
}

const hmOf = (d: Date) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')

/** Assign: Zuständigkeit setzen oder entfernen. */
export async function assignTaskAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const task = await loadTask(ctx, fd(form, 'id'), 'task.manage')
    const assigneeId = fd(form, 'assigneeId') || null
    if (assigneeId && !(await usersWithPermission(ctx.org.id, 'task.complete', task.unitId)).includes(assigneeId)) return err('tasks.errors.assignee', 'assigneeId')
    if (assigneeId === task.assigneeId) return { ok: true }
    const after = await db.task.update({ where: { id: task.id }, data: { assigneeId } })
    await audit(ctx, { action: 'task.assign', entityType: 'Task', entityId: task.id, before: { assigneeId: task.assigneeId }, after: { assigneeId }, context: { residentId: task.residentId } })
    await emit({ orgId: ctx.org.id, type: 'task.created', unitId: task.unitId, residentId: task.residentId, actorId: ctx.user.id, payload: { taskId: task.id, action: 'assigned' } })
    if (assigneeId && assigneeId !== ctx.user.id) {
      await notify({ orgId: ctx.org.id, userIds: [assigneeId], priority: after.priority === 'critical' ? 'critical' : 'action', kind: 'task', title: ctx.t('tasks.notify.assigned', { title: taskTitle(ctx.t, after) }), body: [who(task), hmOf(after.dueAt)].filter(Boolean).join(' · '), href: '/tasks?f=mine', groupKey: 'task-assigned:' + assigneeId })
    }
    refresh()
    return { ok: true, message: ctx.t(assigneeId ? 'tasks.toast.assigned' : 'tasks.toast.unassigned') }
  }) as Promise<ActionResult>
}

/** In Bearbeitung nehmen; ohne Zuständigkeit übernimmt die eigene Person. */
export async function startTaskAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const task = await loadTask(ctx, fd(form, 'id'), 'task.complete')
    if (isClosed(task.status)) return err('tasks.errors.closed')
    const after = await db.task.update({ where: { id: task.id }, data: { status: 'in_progress', assigneeId: task.assigneeId ?? ctx.user.id } })
    await audit(ctx, { action: 'task.start', entityType: 'Task', entityId: task.id, before: snapshot(task), after: snapshot(after), context: { residentId: task.residentId } })
    await emit({ orgId: ctx.org.id, type: 'task.created', unitId: task.unitId, residentId: task.residentId, actorId: ctx.user.id, payload: { taskId: task.id, action: 'started' } })
    refresh()
    return { ok: true, message: ctx.t('tasks.toast.started') }
  }) as Promise<ActionResult>
}

/** Complete: erledigt, teilweise oder übersprungen (mit Begründung, PRD §12.3). */
export async function completeTaskAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const task = await loadTask(ctx, fd(form, 'id'), 'task.complete')
    if (isMedSlot(task)) return err('tasks.errors.medViaMar')
    const status = fd(form, 'status') as 'done' | 'partial' | 'skipped'
    if (!['done', 'partial', 'skipped'].includes(status)) return err('common.genericError')
    if (isClosed(task.status)) return err('tasks.errors.closed')
    const reason = fd(form, 'reason')
    if (status !== 'done' && reason.length < 3) return err('tasks.errors.reason', 'reason')
    const after = await db.task.update({ where: { id: task.id }, data: { status, completedById: ctx.user.id, completedAt: new Date(), note: reason || task.note } })
    await audit(ctx, { action: 'task.complete', entityType: 'Task', entityId: task.id, before: snapshot(task), after: snapshot(after), context: { residentId: task.residentId } })
    await emit({ orgId: ctx.org.id, type: 'task.completed', unitId: task.unitId, residentId: task.residentId, actorId: ctx.user.id, payload: { taskId: task.id, status } })
    refresh()
    return { ok: true, message: ctx.t('tasks.toast.' + status, { title: taskTitle(ctx.t, task) }) }
  }) as Promise<ActionResult>
}

/** Undo einer Quittierung (ungefährliche Aktion, PRD §32). */
export async function reopenTaskAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const task = await loadTask(ctx, fd(form, 'id'), 'task.complete')
    if (isMedSlot(task)) return err('tasks.errors.medViaMar')
    if (!isClosed(task.status) && task.status !== 'escalated') return { ok: true }
    const after = await db.task.update({ where: { id: task.id }, data: { status: 'planned', completedById: null, completedAt: null } })
    await audit(ctx, { action: 'task.reopen', entityType: 'Task', entityId: task.id, before: snapshot(task), after: snapshot(after), context: { residentId: task.residentId } })
    await emit({ orgId: ctx.org.id, type: 'task.reopened', unitId: task.unitId, residentId: task.residentId, actorId: ctx.user.id, payload: { taskId: task.id } })
    refresh()
    return { ok: true, message: ctx.t('tasks.toast.reopened') }
  }) as Promise<ActionResult>
}

/** Escalate: Status eskaliert, Stationsleitung wird kritisch benachrichtigt. */
export async function escalateTaskAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { t } = ctx
    const task = await loadTask(ctx, fd(form, 'id'), 'task.complete')
    if (isClosed(task.status)) return err('tasks.errors.closed')
    if (task.status === 'escalated') return err('tasks.errors.alreadyEscalated')
    const reason = fd(form, 'reason')
    if (reason.length < 3) return err('tasks.errors.reason', 'reason')
    const after = await db.task.update({ where: { id: task.id }, data: { status: 'escalated', note: reason } })
    const leads = (await usersWithPermission(ctx.org.id, 'schedule.manage', task.unitId)).filter((id) => id !== ctx.user.id)
    await notify({
      orgId: ctx.org.id, userIds: leads, priority: 'critical', kind: 'task.escalated',
      title: t('tasks.notify.escalated', { title: taskTitle(t, task) }), body: [who(task), reason, `${ctx.user.firstName} ${ctx.user.lastName}`].filter(Boolean).join(' · '),
      href: task.residentId ? `/residents/${task.residentId}/day` : '/tasks', groupKey: 'task-esc:' + task.id,
    })
    await audit(ctx, { action: 'task.escalate', entityType: 'Task', entityId: task.id, before: snapshot(task), after: snapshot(after), context: { residentId: task.residentId, notified: leads.length, reason } })
    await emit({ orgId: ctx.org.id, type: 'task.escalated', unitId: task.unitId, residentId: task.residentId, actorId: ctx.user.id, payload: { taskId: task.id } })
    refresh()
    return { ok: true, message: t('tasks.toast.escalated', { n: leads.length }) }
  }) as Promise<ActionResult>
}

/**
 * Sammelquittierung eines Zeitpunkts (z. B. alle «Kontrollgang 21:30»): nach Bestätigung im Dialog,
 * jede Aufgabe einzeln geprüft und protokolliert. Medikamenten-Zeitpunkte und bereits abgeschlossene werden übersprungen.
 */
export async function completeManyAction(form: FormData): Promise<ActionResult<{ ids: string[] }>> {
  return run<{ ids: string[] }>(async () => {
    const ctx = await getCtx()
    const ids = [...new Set(fd(form, 'ids').split(',').filter(Boolean))].slice(0, 100)
    if (!ids.length) return { ok: false, error: 'common.genericError' }
    const done: string[] = []
    const units = new Set<string>()
    for (const id of ids) {
      const task = await loadTask(ctx, id, 'task.complete')
      if (isMedSlot(task) || isClosed(task.status)) continue
      const after = await db.task.update({ where: { id: task.id }, data: { status: 'done', completedById: ctx.user.id, completedAt: new Date() } })
      await audit(ctx, { action: 'task.complete', entityType: 'Task', entityId: task.id, before: snapshot(task), after: snapshot(after), context: { residentId: task.residentId, bulk: ids.length } })
      done.push(task.id)
      units.add(task.unitId)
    }
    for (const unitId of units) await emit({ orgId: ctx.org.id, type: 'task.completed', unitId, actorId: ctx.user.id, payload: { taskIds: done, status: 'done' } })
    refresh()
    return { ok: true, message: ctx.t('tasks.bulk.toast', { n: done.length }), data: { ids: done } }
  })
}

/** Undo der Sammelquittierung: nur eigene Quittierungen der letzten 10 Minuten. */
export async function reopenManyAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const ids = [...new Set(fd(form, 'ids').split(',').filter(Boolean))].slice(0, 100)
    const since = new Date(Date.now() - 10 * 60_000)
    let n = 0
    const units = new Set<string>()
    for (const id of ids) {
      const task = await loadTask(ctx, id, 'task.complete')
      if (task.status !== 'done' || task.completedById !== ctx.user.id || !task.completedAt || task.completedAt < since) continue
      const after = await db.task.update({ where: { id: task.id }, data: { status: 'planned', completedById: null, completedAt: null } })
      await audit(ctx, { action: 'task.reopen', entityType: 'Task', entityId: task.id, before: snapshot(task), after: snapshot(after), context: { residentId: task.residentId, bulk: ids.length } })
      units.add(task.unitId)
      n++
    }
    for (const unitId of units) await emit({ orgId: ctx.org.id, type: 'task.reopened', unitId, actorId: ctx.user.id })
    refresh()
    return { ok: true, message: ctx.t('tasks.bulk.undone', { n }) }
  })
}
