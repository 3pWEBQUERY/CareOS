'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import type { IncidentStage, Severity } from '@prisma/client'
import { db } from '@/lib/db'
import { assertCan, getCtx, residentInScope, type Ctx } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify, usersWithPermission } from '@/lib/notify'
import { aiDraft, aiFeedback, AiUnavailable } from '@/lib/ai'
import { addDays, addMinutes } from '@/lib/time'
import { actionTitle, anonymisedAggregates, MANAGE_STAGES, qualityUnits, SEVERITIES, STAGES, stageIndex, workflowSteps } from './_lib'

const severity = z.enum(SEVERITIES, { message: 'quality.errors.severity' })

/** Ereignis melden und Folgeprozess starten (PRD §22, §48 Smart Workflows). */
export async function reportIncidentAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await getCtx()
    const input = z
      .object({
        typeId: z.string().min(1, 'quality.errors.type'),
        residentId: z.string(),
        unitId: z.string(),
        occurredAt: z.string().min(1, 'quality.errors.occurredAt'),
        place: z.string().max(200),
        description: z.string().min(3, 'quality.errors.description').max(5000),
        immediateActions: z.string().max(5000),
        severity,
      })
      .parse({
        typeId: fd(form, 'typeId'), residentId: fd(form, 'residentId'), unitId: fd(form, 'unitId'), occurredAt: fd(form, 'occurredAt'),
        place: fd(form, 'place'), description: fd(form, 'description'), immediateActions: fd(form, 'immediateActions'), severity: fd(form, 'severity') || 'none',
      })
    const nearMiss = fdBool(form, 'nearMiss')
    const occurredAt = new Date(input.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) return { ok: false, error: 'quality.errors.occurredAt', field: 'occurredAt' }
    if (occurredAt > addMinutes(new Date(), 5)) return { ok: false, error: 'quality.errors.future', field: 'occurredAt' }
    if (occurredAt < addDays(new Date(), -365)) return { ok: false, error: 'quality.errors.tooOld', field: 'occurredAt' }

    const type = await db.incidentType.findFirst({ where: { id: input.typeId, orgId: ctx.org.id, active: true } })
    if (!type) return { ok: false, error: 'quality.errors.type', field: 'typeId' }

    let resident: Awaited<ReturnType<typeof residentInScope>> = null
    if (input.residentId) {
      resident = await residentInScope(ctx, input.residentId)
      if (!resident) return { ok: false, error: 'quality.errors.resident', field: 'residentId' }
    }
    const unit = ctx.units.find((u) => u.id === (resident?.unitId ?? input.unitId))
    if (!unit) return { ok: false, error: 'quality.errors.unit', field: 'unitId' }
    assertCan(ctx, 'quality.report', { unitId: unit.id, locationId: unit.locationId })

    const steps = workflowSteps(type)
    const sev = input.severity as Severity
    const result = await db.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          orgId: ctx.org.id, unitId: unit.id, residentId: resident?.id ?? null, typeId: type.id, occurredAt,
          place: input.place || null, description: input.description, immediateActions: input.immediateActions || null,
          severity: sev, nearMiss, stage: input.immediateActions ? 'immediate' : 'reported', reportedById: ctx.user.id,
        },
      })
      const taskIds: string[] = []
      for (const s of steps) {
        const task = await tx.task.create({
          data: {
            orgId: ctx.org.id, unitId: unit.id, residentId: resident?.id ?? null, title: 'incident.' + s.key, category: s.category,
            dueAt: addMinutes(occurredAt, s.offsetMin), durationMin: s.durationMin, priority: 'important', source: 'quality',
            sourceId: `${incident.id}:${s.key}`, createdById: ctx.user.id,
          },
        })
        taskIds.push(task.id)
        await tx.incidentAction.create({ data: { incidentId: incident.id, title: 'incident.' + s.key, dueAt: task.dueAt, taskId: task.id } })
      }
      let observationId: string | null = null
      if (resident) {
        const text = [`${type.name}: ${input.description}`, input.immediateActions && `${ctx.t('quality.fields.immediateActions')}: ${input.immediateActions}`].filter(Boolean).join('\n')
        const obs = await tx.observation.create({
          data: {
            residentId: resident.id, at: occurredAt, category: 'incident', text, authorId: ctx.user.id, source: 'system', important: true,
            structured: { incidentId: incident.id, type: type.key, severity: sev, nearMiss },
          },
        })
        observationId = obs.id
      }
      await audit(ctx, {
        action: 'incident.report', entityType: 'incident', entityId: incident.id,
        after: { type: type.key, occurredAt, place: incident.place, severity: sev, nearMiss, stage: incident.stage, description: input.description, immediateActions: incident.immediateActions, tasks: taskIds.length },
        context: { residentId: resident?.id ?? null, unitId: unit.id, observationId },
      }, tx)
      return { incident, taskIds, observationId }
    })

    const { incident } = result
    const leads = (await usersWithPermission(ctx.org.id, 'quality.manage', unit.id)).filter((id) => id !== ctx.user.id)
    const who = resident ? `${resident.lastName} ${resident.firstName}${resident.room ? ' · ' + resident.room.number : ''}` : unit.name
    await notify({
      orgId: ctx.org.id, userIds: leads, priority: sev === 'severe' || sev === 'moderate' ? 'critical' : 'action', kind: 'incident',
      title: ctx.t('quality.notify.title', { type: type.name, who }), body: input.description.slice(0, 200), href: `/quality/${incident.id}`,
    })
    await emit({ orgId: ctx.org.id, type: 'incident.reported', unitId: unit.id, residentId: resident?.id, actorId: ctx.user.id, payload: { incidentId: incident.id, type: type.key, severity: sev, nearMiss } })
    if (result.taskIds.length) await emit({ orgId: ctx.org.id, type: 'task.created', unitId: unit.id, residentId: resident?.id, actorId: ctx.user.id, payload: { source: 'quality', incidentId: incident.id, n: result.taskIds.length } })
    if (result.observationId) await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: unit.id, residentId: resident?.id, actorId: ctx.user.id, payload: { observationId: result.observationId, category: 'incident' } })
    return { ok: true, data: { id: incident.id }, message: 'quality.report.done' }
  })
}

async function loadIncident(ctx: Ctx, id: string) {
  const inc = await db.incident.findFirst({ where: { id, orgId: ctx.org.id, unitId: { in: qualityUnits(ctx).map((u) => u.id) } }, include: { unit: true } })
  return inc
}

/** Speichert die Felder einer Stufe und rückt optional zur nächsten Stufe vor. */
export async function saveStageAction(id: string, stage: IncidentStage, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const inc = await loadIncident(ctx, id)
    if (!inc) return { ok: false, error: 'common.notFound' }
    if (inc.stage === 'closed') return { ok: false, error: 'quality.errors.closed' }
    const scope = { unitId: inc.unitId, locationId: inc.unit.locationId }
    assertCan(ctx, MANAGE_STAGES.includes(stage) ? 'quality.manage' : 'quality.report', scope)

    const advance = fd(form, 'intent') === 'advance'
    const data: Record<string, unknown> = {}
    if (stage === 'immediate') data.immediateActions = fd(form, 'immediateActions') || null
    if (stage === 'assessment') {
      data.assessment = fd(form, 'assessment') || null
      const sev = fd(form, 'severity')
      if (sev) data.severity = severity.parse(sev)
    }
    if (stage === 'analysis') data.analysis = fd(form, 'analysis') || null
    if (stage === 'closed') data.conclusion = fd(form, 'conclusion') || null

    let next: IncidentStage | null = null
    if (advance) {
      const i = stageIndex(stage)
      if (stageIndex(inc.stage) > i) return { ok: false, error: 'quality.errors.stage' }
      next = stage === 'closed' ? 'closed' : STAGES[i + 1]
      // Abschluss nur über die Stufe "Abschluss" mit Schlussfolgerung
      if (next === 'closed' && stage !== 'closed') next = null
      if (next && MANAGE_STAGES.includes(next)) assertCan(ctx, 'quality.manage', scope)
      if (stage === 'immediate' && !data.immediateActions) return { ok: false, error: 'quality.errors.immediateRequired', field: 'immediateActions' }
      if (stage === 'assessment' && !data.assessment) return { ok: false, error: 'quality.errors.assessmentRequired', field: 'assessment' }
      if (stage === 'analysis' && !data.analysis) return { ok: false, error: 'quality.errors.analysisRequired', field: 'analysis' }
      if (stage === 'closed') {
        if (!data.conclusion) return { ok: false, error: 'quality.errors.conclusionRequired', field: 'conclusion' }
        data.closedAt = new Date()
        data.closedById = ctx.user.id
      }
      if (next) data.stage = next
    }
    const before = Object.fromEntries(Object.keys(data).map((k) => [k, (inc as Record<string, unknown>)[k] ?? null]))
    await db.incident.update({ where: { id }, data })
    await audit(ctx, {
      action: next === 'closed' ? 'incident.close' : next ? 'incident.stage' : 'incident.update',
      entityType: 'incident', entityId: id, before, after: data, context: { residentId: inc.residentId, stage },
    })
    await emit({ orgId: ctx.org.id, type: 'incident.updated', unitId: inc.unitId, residentId: inc.residentId, actorId: ctx.user.id, payload: { incidentId: id, stage: next ?? inc.stage } })
    refresh()
    return { ok: true, message: next === 'closed' ? 'quality.audit.incident_close' : next ? 'quality.detail.advanced' : 'common.saved' }
  })
}

/** Zusätzliche Massnahme, optional als Aufgabe im Bereich. */
export async function addActionAction(id: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const inc = await loadIncident(ctx, id)
    if (!inc) return { ok: false, error: 'common.notFound' }
    if (inc.stage === 'closed') return { ok: false, error: 'quality.errors.closed' }
    assertCan(ctx, 'quality.report', { unitId: inc.unitId, locationId: inc.unit.locationId })
    const title = fd(form, 'title')
    if (title.length < 2) return { ok: false, error: 'quality.errors.actionTitle', field: 'title' }
    const dueRaw = fd(form, 'dueAt')
    const dueAt = dueRaw ? new Date(dueRaw) : null
    if (dueAt && Number.isNaN(dueAt.getTime())) return { ok: false, error: 'quality.errors.due', field: 'dueAt' }
    const asTask = fdBool(form, 'asTask') && dueAt != null
    const assigneeId = fd(form, 'assigneeId') || null
    if (assigneeId && !(await actionStaff(ctx.org.id, inc.unitId)).includes(assigneeId)) return { ok: false, error: 'quality.errors.assignee', field: 'assigneeId' }
    const action = await db.$transaction(async (tx) => {
      const a = await tx.incidentAction.create({ data: { incidentId: id, title: title.slice(0, 300), dueAt, assigneeId } })
      if (asTask && dueAt) {
        const task = await tx.task.create({
          data: {
            orgId: ctx.org.id, unitId: inc.unitId, residentId: inc.residentId, title: title.slice(0, 300), category: ctx.t('quality.taskCategory'),
            dueAt, durationMin: 10, priority: 'important', source: 'quality', sourceId: `${id}:${a.id}`, createdById: ctx.user.id, assigneeId,
          },
        })
        await tx.incidentAction.update({ where: { id: a.id }, data: { taskId: task.id } })
        return { ...a, taskId: task.id }
      }
      return a
    })
    await audit(ctx, { action: 'incident.action.add', entityType: 'incident_action', entityId: action.id, after: { title, dueAt, taskId: action.taskId, assigneeId }, context: { incidentId: id, residentId: inc.residentId } })
    if (assigneeId && assigneeId !== ctx.user.id) await notifyAssignee(ctx, inc, assigneeId, title)
    await emit({ orgId: ctx.org.id, type: 'incident.updated', unitId: inc.unitId, residentId: inc.residentId, actorId: ctx.user.id, payload: { incidentId: id } })
    if (action.taskId) await emit({ orgId: ctx.org.id, type: 'task.created', unitId: inc.unitId, residentId: inc.residentId, actorId: ctx.user.id, payload: { taskId: action.taskId } })
    refresh()
    return { ok: true, message: 'quality.detail.actionAdded' }
  })
}

/** Massnahme erledigt / wieder offen. Eine verknüpfte Aufgabe wird mitgeführt. */
export async function toggleActionAction(actionId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const a = await db.incidentAction.findUnique({ where: { id: actionId }, include: { incident: { include: { unit: true } } } })
    if (!a || a.incident.orgId !== ctx.org.id || !qualityUnits(ctx).some((u) => u.id === a.incident.unitId)) return { ok: false, error: 'common.notFound' }
    if (a.incident.stage === 'closed') return { ok: false, error: 'quality.errors.closed' }
    assertCan(ctx, 'quality.report', { unitId: a.incident.unitId, locationId: a.incident.unit.locationId })
    const task = a.taskId ? await db.task.findUnique({ where: { id: a.taskId } }) : null
    const isDone = task ? task.status === 'done' || task.status === 'partial' : a.doneAt != null
    const now = new Date()
    await db.$transaction(async (tx) => {
      await tx.incidentAction.update({ where: { id: a.id }, data: isDone ? { doneAt: null, doneById: null } : { doneAt: now, doneById: ctx.user.id } })
      if (task) {
        await tx.task.update({
          where: { id: task.id },
          data: isDone ? { status: 'planned', completedAt: null, completedById: null } : { status: 'done', completedAt: now, completedById: ctx.user.id },
        })
      }
      await audit(ctx, {
        action: isDone ? 'incident.action.reopen' : 'incident.action.done', entityType: 'incident_action', entityId: a.id,
        before: { done: isDone, taskStatus: task?.status ?? null }, after: { done: !isDone },
        context: { incidentId: a.incidentId, residentId: a.incident.residentId, taskId: task?.id ?? null },
      }, tx)
    })
    if (task) await emit({ orgId: ctx.org.id, type: isDone ? 'task.reopened' : 'task.completed', unitId: task.unitId, residentId: task.residentId, actorId: ctx.user.id, payload: { taskId: task.id } })
    await emit({ orgId: ctx.org.id, type: 'incident.updated', unitId: a.incident.unitId, residentId: a.incident.residentId, actorId: ctx.user.id, payload: { incidentId: a.incidentId } })
    refresh()
  })
}

/** Personen, denen Massnahmen eines Bereichs zugewiesen werden können: Aufgaben quittieren oder Ereignisse bearbeiten. */
async function actionStaff(orgId: string, unitId: string) {
  const [a, b] = await Promise.all([usersWithPermission(orgId, 'task.complete', unitId), usersWithPermission(orgId, 'quality.manage', unitId)])
  return [...new Set([...a, ...b])]
}

async function notifyAssignee(ctx: Ctx, inc: { id: string; unitId: string }, userId: string, title: string) {
  await notify({
    orgId: ctx.org.id, userIds: [userId], priority: 'action', kind: 'incident.action',
    title: ctx.t('quality.notify.actionAssigned', { title: actionTitle(ctx.t, title) }), body: `${ctx.user.firstName} ${ctx.user.lastName}`,
    href: `/quality/${inc.id}?s=followup`, groupKey: 'incident-action:' + userId,
  })
}

/** Assign (PRD §49): Massnahme einer Person zuweisen; eine verknüpfte Aufgabe erhält dieselbe Zuständigkeit. */
export async function assignIncidentActionAction(actionId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const a = await db.incidentAction.findUnique({ where: { id: actionId }, include: { incident: { include: { unit: true } } } })
    if (!a || a.incident.orgId !== ctx.org.id || !qualityUnits(ctx).some((u) => u.id === a.incident.unitId)) return { ok: false, error: 'common.notFound' }
    if (a.incident.stage === 'closed') return { ok: false, error: 'quality.errors.closed' }
    assertCan(ctx, 'quality.report', { unitId: a.incident.unitId, locationId: a.incident.unit.locationId })
    const assigneeId = fd(form, 'assigneeId') || null
    if (assigneeId && !(await actionStaff(ctx.org.id, a.incident.unitId)).includes(assigneeId)) return { ok: false, error: 'quality.errors.assignee', field: 'assigneeId' }
    if (assigneeId === a.assigneeId) return { ok: true }
    await db.$transaction(async (tx) => {
      await tx.incidentAction.update({ where: { id: a.id }, data: { assigneeId } })
      if (a.taskId) await tx.task.updateMany({ where: { id: a.taskId, orgId: ctx.org.id }, data: { assigneeId } })
      await audit(ctx, {
        action: 'incident.action.assign', entityType: 'incident_action', entityId: a.id,
        before: { assigneeId: a.assigneeId }, after: { assigneeId }, context: { incidentId: a.incidentId, residentId: a.incident.residentId, taskId: a.taskId },
      }, tx)
    })
    if (assigneeId && assigneeId !== ctx.user.id) await notifyAssignee(ctx, a.incident, assigneeId, a.title)
    if (a.taskId) await emit({ orgId: ctx.org.id, type: 'task.created', unitId: a.incident.unitId, residentId: a.incident.residentId, actorId: ctx.user.id, payload: { taskId: a.taskId, action: 'assigned' } })
    await emit({ orgId: ctx.org.id, type: 'incident.updated', unitId: a.incident.unitId, residentId: a.incident.residentId, actorId: ctx.user.id, payload: { incidentId: a.incidentId } })
    refresh()
    return { ok: true, message: assigneeId ? 'tasks.toast.assigned' : 'tasks.toast.unassigned' }
  })
}

export type PatternFilter = { type?: string; unit?: string; period?: string; nearMiss?: boolean }

/** Quality Assistant: sendet ausschliesslich anonymisierte Zählungen an CareOS AI. */
export async function analyzePatternsAction(f: PatternFilter): Promise<ActionResult<{ id: string; text: string }>> {
  return run(async () => {
    const ctx = await getCtx()
    const units = qualityUnits(ctx)
    if (!units.length) return { ok: false, error: 'common.notAllowed' }
    const unitIds = f.unit && units.some((u) => u.id === f.unit) ? [f.unit] : units.map((u) => u.id)
    const days = Number(f.period) || 365
    const from = addDays(new Date(), -days)
    const rows = await db.incident.findMany({
      where: { orgId: ctx.org.id, unitId: { in: unitIds }, occurredAt: { gte: from }, ...(f.type ? { typeId: f.type } : {}), ...(f.nearMiss ? { nearMiss: true } : {}) },
      select: { occurredAt: true, place: true, severity: true, nearMiss: true, residentId: true, type: { select: { key: true, name: true } } },
    })
    if (rows.length < 2) return { ok: false, error: 'quality.ai.tooFew' }
    const agg = anonymisedAggregates(rows, from, new Date())
    try {
      const r = await aiDraft(
        ctx,
        'quality',
        `Du bist der Quality Assistant von CareOS. Du erhältst ausschliesslich anonymisierte Zählungen von Qualitätsereignissen (keine Personen).
Aufgabe: Beschreibe auffällige Muster und Häufungen (Typ, Tageszeit, Wochentag, Ort, Schweregrad, Wiederholungen) und formuliere 3–5 Prüffragen für die Fallbesprechung im Team.
Keine Schuldzuweisung an Personen, keine Diagnosen, keine Therapie- oder Medikationsempfehlungen. Bei geringer Fallzahl ausdrücklich auf eingeschränkte Aussagekraft hinweisen.
Form: zwei kurze Abschnitte "Beobachtete Muster" und "Prüffragen", jeweils als Aufzählung mit "- ".`,
        JSON.stringify(agg, null, 1),
        900,
      )
      await audit(ctx, { action: 'incident.ai.analyze', entityType: 'incident', after: { n: rows.length, aiInteractionId: r.id }, context: { unitIds, days } })
      return { ok: true, data: r }
    } catch (e) {
      if (e instanceof AiUnavailable) return { ok: false, error: 'common.ai.unavailable' }
      throw e
    }
  })
}

export async function aiFeedbackAction(id: string, accepted: boolean) {
  const ctx = await getCtx()
  await aiFeedback(ctx, id, accepted)
}
