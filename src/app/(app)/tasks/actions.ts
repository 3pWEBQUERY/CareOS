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
import { ensureTasksForDay, invalidateTaskGeneration, isClosed, syncIncidentActions } from '@/lib/tasks'
import { addDays, atTime, dbDate, fmtDayMonth, fromDbDate, parseDateKey, startOfDay } from '@/lib/time'
import { nextOccurrence, RecurrenceInput } from '@/lib/recurrence'

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
    // «Wiederholen» (PRD §12.1): statt einer Einzelaufgabe entsteht eine Vorlage; die Aufgaben erzeugt ensureTasksForDay.
    const rhythm = fd(form, 'rhythm')
    if (rhythm && rhythm !== 'none') {
      const rec = RecurrenceInput.safeParse({
        rhythm, every: fd(form, 'every') || '1', weekdays: form.getAll('weekdays').map(String), monthDay: fd(form, 'monthDay'),
        times: time, startDate: date, endDate: fd(form, 'endDate'),
      })
      if (!rec.success) {
        const f = String(rec.error.issues[0]?.path[0] ?? '')
        return err(rec.error.issues[0]?.message ?? 'common.genericError', ({ times: 'time', startDate: 'date' } as Record<string, string>)[f] ?? f)
      }
      const r = rec.data
      const tpl = await db.taskTemplate.create({
        data: {
          orgId: ctx.org.id, unitId, residentId: residentId || null, title, description: fd(form, 'description') || null, category: fd(form, 'category') || t('tasks.categoryDefault'),
          rhythm: r.rhythm, every: r.every, weekdays: r.rhythm === 'weekly' ? r.weekdays : [], monthDay: r.rhythm === 'monthly' ? r.monthDay : null, times: r.times,
          startDate: dbDate(parseDateKey(r.startDate)), endDate: r.endDate ? dbDate(parseDateKey(r.endDate)) : null,
          durationMin: Math.round(dur), priority, assigneeId, createdById: ctx.user.id,
        },
      })
      await audit(ctx, { action: 'task.template.create', entityType: 'TaskTemplate', entityId: tpl.id, after: tpl, context: { residentId: tpl.residentId, unitId } })
      const next = nextOccurrence({ ...r, startDate: parseDateKey(r.startDate), endDate: r.endDate ? parseDateKey(r.endDate) : null }, new Date() > parseDateKey(r.startDate) ? new Date() : parseDateKey(r.startDate))
      invalidateTaskGeneration(unitId)
      if (next && next < addDays(startOfDay(), 2)) await ensureTasksForDay(unitId, next)
      await emit({ orgId: ctx.org.id, type: 'task.created', unitId, residentId: tpl.residentId, actorId: ctx.user.id, payload: { templateId: tpl.id } })
      refresh()
      return { ok: true, message: next ? t('tasks.recur.created', { next: `${fmtDayMonth(next, ctx.locale)} ${r.times[0]}` }) : t('tasks.toast.created') }
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
    // Bedingtes Update: zwei Geräte gleichzeitig (Echtzeit-Konflikt) buchen nicht doppelt
    const upd = await db.task.updateMany({ where: { id: task.id, status: { notIn: ['done', 'partial', 'skipped'] } }, data: { status, completedById: ctx.user.id, completedAt: new Date(), note: reason || task.note } })
    if (!upd.count) return err('tasks.errors.closed')
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    await audit(ctx, { action: 'task.complete', entityType: 'Task', entityId: task.id, before: snapshot(task), after: snapshot(after), context: { residentId: task.residentId } })
    if (task.source === 'quality') await syncIncidentActions([task.id])
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
    if (task.source === 'quality') await syncIncidentActions([task.id])
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
    await syncIncidentActions(done)
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
    await syncIncidentActions(ids)
    for (const unitId of units) await emit({ orgId: ctx.org.id, type: 'task.reopened', unitId, actorId: ctx.user.id })
    refresh()
    return { ok: true, message: ctx.t('tasks.bulk.undone', { n }) }
  })
}

// ───────── Wiederkehrende Aufgaben (Vorlagen) ─────────

/** Vorlagen pflegen: Aufgaben verwalten im Bereich oder Klinische Konfiguration (Admin). */
function assertTemplates(ctx: Ctx, unitId: string) {
  if (ctx.can('admin.config')) return
  const unit = ctx.units.find((u) => u.id === unitId)
  assertCan(ctx, 'task.manage', { unitId, locationId: unit?.locationId })
}
const tplSnapshot = (x: { title: string; rhythm: string; every: number; weekdays: number[]; monthDay: number | null; times: string[]; startDate: Date; endDate: Date | null; active: boolean; residentId: string | null; assigneeId: string | null; priority: string; durationMin: number; category: string; description: string | null }) => ({
  title: x.title, rhythm: x.rhythm, every: x.every, weekdays: x.weekdays, monthDay: x.monthDay, times: x.times, startDate: x.startDate, endDate: x.endDate,
  active: x.active, residentId: x.residentId, assigneeId: x.assigneeId, priority: x.priority, durationMin: x.durationMin, category: x.category, description: x.description,
})

/** Künftige, noch nicht begonnene Aufgaben einer Vorlage entfernen (nach Änderung oder Ende der Serie). */
async function dropFutureTasks(templateId: string) {
  return (await db.task.deleteMany({ where: { source: 'recurring', sourceId: templateId, status: { in: ['planned', 'ready'] }, dueAt: { gt: new Date() } } })).count
}

/** Create/Update einer Vorlage (Admin → Klinische Konfiguration bzw. «Serie bearbeiten» in Aufgaben). */
export async function saveTaskTemplateAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const id = fd(form, 'id')
    const before = id ? await db.taskTemplate.findFirst({ where: { id, orgId: ctx.org.id } }) : null
    if (id && !before) return err('common.notFound')
    const unitId = before?.unitId ?? fd(form, 'unitId')
    if (!ctx.units.some((u) => u.id === unitId)) return err('tasks.errors.noUnit', 'unitId')
    assertTemplates(ctx, unitId)
    const title = fd(form, 'title')
    if (title.length < 2 || title.length > 200) return err('tasks.errors.title', 'title')
    const residentId = fd(form, 'residentId') || null
    if (residentId) {
      const r = await residentInScope(ctx, residentId)
      if (!r || r.unitId !== unitId) return err('tasks.recur.errors.resident', 'residentId')
    }
    const dur = fdNum(form, 'durationMin') ?? 10
    if (Number.isNaN(dur) || dur < 1 || dur > 480) return err('tasks.errors.duration', 'durationMin')
    const priority = (['critical', 'important', 'routine'].includes(fd(form, 'priority')) ? fd(form, 'priority') : 'routine') as Priority
    const assigneeId = fd(form, 'assigneeId') || null
    if (assigneeId && !(await usersWithPermission(ctx.org.id, 'task.complete', unitId)).includes(assigneeId)) return err('tasks.errors.assignee', 'assigneeId')
    const rec = RecurrenceInput.safeParse({
      rhythm: fd(form, 'rhythm'), every: fd(form, 'every') || '1', weekdays: form.getAll('weekdays').map(String), monthDay: fd(form, 'monthDay'),
      times: fd(form, 'times'), startDate: fd(form, 'startDate'), endDate: fd(form, 'endDate'),
    })
    if (!rec.success) return err(rec.error.issues[0]?.message ?? 'common.genericError', String(rec.error.issues[0]?.path[0] ?? ''))
    const r = rec.data
    const data = {
      residentId, title, description: fd(form, 'description').slice(0, 2000) || null, category: (fd(form, 'category') || ctx.t('tasks.categoryDefault')).slice(0, 60),
      rhythm: r.rhythm, every: r.every, weekdays: r.rhythm === 'weekly' ? r.weekdays : [], monthDay: r.rhythm === 'monthly' ? r.monthDay : null, times: r.times,
      startDate: dbDate(parseDateKey(r.startDate)), endDate: r.endDate ? dbDate(parseDateKey(r.endDate)) : null,
      durationMin: Math.round(dur), priority, assigneeId,
    }
    let tplId: string
    if (before) {
      const after = await db.taskTemplate.update({ where: { id: before.id }, data })
      const dropped = await dropFutureTasks(before.id)
      await audit(ctx, { action: 'task.template.update', entityType: 'TaskTemplate', entityId: before.id, before: tplSnapshot(before), after: tplSnapshot(after), context: { unitId, residentId, droppedTasks: dropped } })
      tplId = before.id
    } else {
      const tpl = await db.taskTemplate.create({ data: { ...data, orgId: ctx.org.id, unitId, createdById: ctx.user.id } })
      await audit(ctx, { action: 'task.template.create', entityType: 'TaskTemplate', entityId: tpl.id, after: tplSnapshot(tpl), context: { unitId, residentId } })
      tplId = tpl.id
    }
    invalidateTaskGeneration(unitId)
    await ensureTasksForDay(unitId, new Date())
    await emit({ orgId: ctx.org.id, type: 'task.created', unitId, residentId, actorId: ctx.user.id, payload: { templateId: tplId } })
    refresh()
    return { ok: true, message: ctx.t(before ? 'tasks.recur.saved' : 'tasks.recur.createdPlain') }
  }) as Promise<ActionResult>
}

/** Serie beenden: Vorlage inaktiv, Ende heute; künftige offene Aufgaben entfallen, heutige vergangene bleiben. */
export async function endTaskTemplateAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const tpl = await db.taskTemplate.findFirst({ where: { id: fd(form, 'id'), orgId: ctx.org.id } })
    if (!tpl) return err('common.notFound')
    assertTemplates(ctx, tpl.unitId)
    if (!tpl.active) return { ok: true }
    const today = startOfDay()
    const endDate = tpl.endDate && fromDbDate(tpl.endDate) < today ? tpl.endDate : dbDate(today)
    const after = await db.taskTemplate.update({ where: { id: tpl.id }, data: { active: false, endDate } })
    const dropped = await dropFutureTasks(tpl.id)
    await audit(ctx, { action: 'task.template.end', entityType: 'TaskTemplate', entityId: tpl.id, before: tplSnapshot(tpl), after: tplSnapshot(after), context: { unitId: tpl.unitId, residentId: tpl.residentId, droppedTasks: dropped } })
    invalidateTaskGeneration(tpl.unitId)
    await emit({ orgId: ctx.org.id, type: 'task.reopened', unitId: tpl.unitId, residentId: tpl.residentId, actorId: ctx.user.id, payload: { templateId: tpl.id, ended: true } })
    refresh()
    return { ok: true, message: ctx.t('tasks.recur.ended', { n: dropped }) }
  }) as Promise<ActionResult>
}

/** Beendete Serie wieder aufnehmen (Admin): ab heute, ohne rückwirkende Aufgaben. */
export async function resumeTaskTemplateAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const tpl = await db.taskTemplate.findFirst({ where: { id: fd(form, 'id'), orgId: ctx.org.id } })
    if (!tpl) return err('common.notFound')
    assertTemplates(ctx, tpl.unitId)
    if (tpl.active) return { ok: true }
    const today = dbDate(startOfDay())
    const after = await db.taskTemplate.update({ where: { id: tpl.id }, data: { active: true, endDate: null, startDate: tpl.startDate > today ? tpl.startDate : today } })
    await audit(ctx, { action: 'task.template.resume', entityType: 'TaskTemplate', entityId: tpl.id, before: tplSnapshot(tpl), after: tplSnapshot(after), context: { unitId: tpl.unitId, residentId: tpl.residentId } })
    invalidateTaskGeneration(tpl.unitId)
    refresh()
    return { ok: true, message: ctx.t('tasks.recur.resumed') }
  }) as Promise<ActionResult>
}
