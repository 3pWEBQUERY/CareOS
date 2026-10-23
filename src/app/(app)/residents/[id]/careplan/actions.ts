'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { LIVE } from '@/lib/vitals'
import { ForbiddenError, getCtx, residentInScope, type Ctx } from '@/lib/context'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify, usersWithPermission } from '@/lib/notify'
import { invalidateTaskGeneration, OPEN_STATUSES } from '@/lib/tasks'
import { aiDraft, aiFeedback, AiUnavailable } from '@/lib/ai'
import { aiConfigured } from '@/lib/env'
import { addDays, atTime, dateKey, fmtDate, hm, parseDateKey, startOfDay } from '@/lib/time'
import { IV_CATEGORIES, parseTimes, SUGGESTION_RULES, domainLabel } from '@/lib/care'
import { CARE_DOMAINS } from '@/lib/clinical-config'
import { mergeEdit } from '@/lib/merge-check'
import { conflictMessage } from '@/lib/merge-server'

type Resident = NonNullable<Awaited<ReturnType<typeof residentInScope>>>

async function load(residentId: string, perm: 'resident.careplan.edit' | 'resident.careplan.approve' = 'resident.careplan.edit') {
  const ctx = await getCtx()
  const r = await residentInScope(ctx, residentId, perm)
  if (!r) throw new ForbiddenError(perm)
  return { ctx, r }
}

const fail = (error: string, field?: string): ActionResult<never> => ({ ok: false, error, field })

const planInclude = { areas: { include: { interventions: true } } } satisfies Prisma.CarePlanInclude

/** Liefert den Entwurf der Pflegeplanung; legt ihn als Kopie der aktiven Version an, falls nötig (PRD §9, Versionierung). */
async function ensureDraft(ctx: Ctx, r: Resident) {
  const existing = await db.carePlan.findFirst({ where: { residentId: r.id, status: 'draft' }, orderBy: { version: 'desc' }, include: planInclude })
  if (existing) return existing
  const [active, last] = await Promise.all([
    db.carePlan.findFirst({ where: { residentId: r.id, status: 'active' }, orderBy: { version: 'desc' }, include: planInclude }),
    db.carePlan.findFirst({ where: { residentId: r.id }, orderBy: { version: 'desc' }, select: { version: true } }),
  ])
  const version = (last?.version ?? 0) + 1
  const map: Record<string, string> = {}
  const draft = await db.$transaction(async (tx) => {
    const plan = await tx.carePlan.create({ data: { residentId: r.id, version, status: 'draft', createdById: ctx.user.id, nextEvaluation: active?.nextEvaluation ?? null } })
    for (const a of active?.areas ?? []) {
      const area = await tx.carePlanArea.create({
        data: {
          carePlanId: plan.id, domain: a.domain, situation: a.situation, resources: a.resources, needs: a.needs, risks: a.risks,
          goal: a.goal, evaluation: a.evaluation, evaluateBy: a.evaluateBy, aiSuggested: a.aiSuggested,
        },
      })
      for (const iv of a.interventions.filter((i) => i.active)) {
        // Entwürfe erzeugen keine Aufgaben: Massnahmen werden erst mit der Freigabe aktiv.
        const copy = await tx.intervention.create({
          data: { residentId: r.id, areaId: area.id, title: iv.title, category: iv.category, times: iv.times, weekdays: iv.weekdays, durationMin: iv.durationMin, instructions: iv.instructions, active: false },
        })
        map[copy.id] = iv.id
      }
    }
    return plan
  })
  await audit(ctx, {
    action: 'careplan.version.create', entityType: 'CarePlan', entityId: draft.id,
    after: { version, fromPlanId: active?.id ?? null, interventionMap: map },
    context: { residentId: r.id, carePlanId: draft.id },
  })
  return db.carePlan.findUniqueOrThrow({ where: { id: draft.id }, include: planInclude })
}

async function ensureArea(ctx: Ctx, r: Resident, planId: string, domain: string) {
  const area = await db.carePlanArea.findFirst({ where: { carePlanId: planId, domain } })
  if (area) return area
  const created = await db.carePlanArea.create({ data: { carePlanId: planId, domain } })
  await audit(ctx, { action: 'careplan.area.create', entityType: 'CarePlanArea', entityId: created.id, after: { domain }, context: { residentId: r.id, carePlanId: planId } })
  return created
}

async function done(ctx: Ctx, r: Resident, payload: Record<string, unknown>) {
  await emit({ orgId: ctx.org.id, type: 'careplan.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload })
  invalidateTaskGeneration(r.unitId)
  refresh()
}

const validDomain = async (ctx: Ctx, domain: string) =>
  CARE_DOMAINS.some((d) => d.key === domain) || Boolean(await db.careDomain.findFirst({ where: { orgId: ctx.org.id, key: domain } }))

// ── Plan / Versionen ──

export async function createDraftAction(residentId: string): Promise<ActionResult<{ version: number }>> {
  return run<{ version: number }>(async () => {
    const { ctx, r } = await load(residentId)
    const draft = await ensureDraft(ctx, r)
    await done(ctx, r, { planId: draft.id, step: 'draft' })
    return { ok: true, data: { version: draft.version } }
  })
}

export async function submitAction(residentId: string, planId: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId)
    const plan = await db.carePlan.findFirst({ where: { id: planId, residentId: r.id, status: 'draft' }, include: { areas: true } })
    if (!plan) return fail('care.plan.errors.noDraft')
    if (!plan.areas.length) return fail('care.plan.errors.emptyDraft')
    await audit(ctx, { action: 'careplan.submit', entityType: 'CarePlan', entityId: plan.id, after: { version: plan.version }, context: { residentId: r.id, carePlanId: plan.id } })
    const approvers = (await usersWithPermission(ctx.org.id, 'resident.careplan.approve', r.unitId)).filter((u) => u !== ctx.user.id)
    await notify({
      orgId: ctx.org.id, userIds: approvers, priority: 'action', kind: 'careplan.review',
      title: ctx.t('care.plan.notifyTitle', { name: `${r.lastName} ${r.firstName}`, v: plan.version }),
      body: ctx.t('care.plan.notifyBody', { by: `${ctx.user.firstName} ${ctx.user.lastName}` }),
      href: `/residents/${r.id}/careplan?v=draft`, groupKey: 'careplan.review:' + plan.id,
    })
    await done(ctx, r, { planId: plan.id, step: 'submitted' })
    return { ok: true, message: 'care.plan.submittedToast' }
  })
}

/** Freigabe: nur durch Menschen mit resident.careplan.approve (CareOS AI gibt nie frei, PRD §23.2). */
export async function approveAction(residentId: string, planId: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId, 'resident.careplan.approve')
    const draft = await db.carePlan.findFirst({ where: { id: planId, residentId: r.id, status: 'draft' }, include: planInclude })
    if (!draft) return fail('care.plan.errors.noDraft')
    if (!draft.areas.length) return fail('care.plan.errors.emptyDraft')
    const active = await db.carePlan.findFirst({ where: { residentId: r.id, status: 'active' }, include: planInclude })
    const now = new Date()

    // Zuordnung neue → bisherige Massnahme (aus der Versionsanlage), damit heutige Aufgaben erhalten bleiben.
    const created = await db.auditLog.findFirst({ where: { orgId: ctx.org.id, entityType: 'CarePlan', entityId: draft.id, action: 'careplan.version.create' }, select: { after: true } })
    const map = { ...(((created?.after as { interventionMap?: Record<string, string> } | null)?.interventionMap) ?? {}) }
    const newIvs = draft.areas.flatMap((a) => a.interventions)
    const oldIvs = (active?.areas ?? []).flatMap((a) => a.interventions).filter((i) => i.active)
    const used = new Set(Object.values(map))
    for (const iv of newIvs) {
      if (map[iv.id] && oldIvs.some((o) => o.id === map[iv.id])) continue
      const match = oldIvs.find((o) => !used.has(o.id) && o.title === iv.title && o.category === iv.category)
      if (match) {
        map[iv.id] = match.id
        used.add(match.id)
      } else delete map[iv.id]
    }
    const evals = draft.areas.map((a) => a.evaluateBy).filter((d): d is Date => d != null).sort((a, b) => a.getTime() - b.getTime())

    await db.$transaction(async (tx) => {
      if (active) {
        await tx.carePlan.update({ where: { id: active.id }, data: { status: 'archived' } })
        await tx.intervention.updateMany({ where: { area: { carePlanId: active.id } }, data: { active: false } })
      }
      // Ältere, nie freigegebene Entwürfe bleiben als Archiv erhalten.
      await tx.carePlan.updateMany({ where: { residentId: r.id, status: 'draft', id: { not: draft.id } }, data: { status: 'archived' } })
      await tx.intervention.updateMany({ where: { area: { carePlanId: draft.id } }, data: { active: true } })
      await tx.carePlan.update({ where: { id: draft.id }, data: { status: 'active', approvedById: ctx.user.id, approvedAt: now, nextEvaluation: evals[0] ?? null } })

      const from = startOfDay(now)
      for (const iv of newIvs) {
        const old = map[iv.id]
        if (!old) continue
        await tx.task.updateMany({
          where: { source: 'careplan', sourceId: old, dueAt: { gte: from } },
          data: { sourceId: iv.id, title: iv.title, category: iv.category, durationMin: iv.durationMin, description: iv.instructions },
        })
      }
      // Offene, künftige Aufgaben, die zur neuen Planung nicht mehr passen, entfallen.
      const open = await tx.task.findMany({ where: { residentId: r.id, source: 'careplan', status: { in: ['planned', 'ready'] }, dueAt: { gte: now } }, select: { id: true, sourceId: true, dueAt: true } })
      const byId = new Map(newIvs.map((i) => [i.id, i]))
      const stale = open.filter((k) => {
        const iv = k.sourceId ? byId.get(k.sourceId) : undefined
        if (!iv) return oldIvs.some((o) => o.id === k.sourceId)
        return !iv.times.includes(hm(k.dueAt)) || (iv.weekdays.length > 0 && !iv.weekdays.includes(k.dueAt.getDay()))
      })
      if (stale.length) await tx.task.deleteMany({ where: { id: { in: stale.map((k) => k.id) } } })
      // Zeiten von heute, die vor der Freigabe lagen, waren nie fällig: als nicht fällig vermerken statt als überfällig anzeigen.
      const notDue = ctx.t('care.plan.taskBeforeApproval')
      const past = newIvs.flatMap((iv) =>
        iv.weekdays.length && !iv.weekdays.includes(now.getDay())
          ? []
          : iv.times.map((time) => atTime(now, time)).filter((at) => at < now).map((dueAt) => ({
              orgId: ctx.org.id, unitId: r.unitId, residentId: r.id, title: iv.title, description: iv.instructions, category: iv.category,
              dueAt, durationMin: iv.durationMin, source: 'careplan' as const, sourceId: iv.id, status: 'skipped' as const, note: notDue,
            })),
      )
      if (past.length) await tx.task.createMany({ data: past, skipDuplicates: true })
      // Offene Evaluations-Aufgaben, deren Bereich oder Termin in der neuen Version nicht mehr besteht, entfallen.
      const evalDue = new Set(draft.areas.filter((a) => a.evaluateBy).map((a) => `eval:${r.id}:${a.domain}|${dateKey(a.evaluateBy!)}`))
      const evalOpen = await tx.task.findMany({ where: { residentId: r.id, source: 'careplan', sourceId: { startsWith: `eval:${r.id}:` }, status: { in: ['planned', 'ready'] } }, select: { id: true, sourceId: true, dueAt: true } })
      const evalStale = evalOpen.filter((k) => !evalDue.has(`${k.sourceId}|${dateKey(k.dueAt)}`))
      if (evalStale.length) await tx.task.deleteMany({ where: { id: { in: evalStale.map((k) => k.id) } } })
    })

    await audit(ctx, {
      action: 'careplan.approve', entityType: 'CarePlan', entityId: draft.id,
      before: active ? { activeVersion: active.version, activePlanId: active.id } : null,
      after: { version: draft.version, status: 'active', approvedAt: now, interventions: newIvs.length },
      context: { residentId: r.id, carePlanId: draft.id },
    })
    await done(ctx, r, { planId: draft.id, step: 'approved', version: draft.version })
    return { ok: true, message: 'care.plan.approvedToast' }
  })
}

export async function discardDraftAction(residentId: string, planId: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId)
    const draft = await db.carePlan.findFirst({ where: { id: planId, residentId: r.id, status: 'draft' } })
    if (!draft) return fail('care.plan.errors.noDraft')
    // Nicht löschen: Der verworfene Entwurf bleibt als archivierte, nie freigegebene Version nachvollziehbar.
    await db.carePlan.update({ where: { id: draft.id }, data: { status: 'archived' } })
    await audit(ctx, { action: 'careplan.discard', entityType: 'CarePlan', entityId: draft.id, before: { status: 'draft' }, after: { status: 'archived' }, context: { residentId: r.id, carePlanId: draft.id } })
    await done(ctx, r, { planId: draft.id, step: 'discarded' })
    return { ok: true, message: 'care.plan.discarded' }
  })
}

// ── Pflegebereich (Planning Flow) ──

export type IvInput = { id?: string; title: string; category: string; times: string; weekdays: number[]; durationMin: number; instructions: string }

export type AreaInput = {
  domain: string
  situation: string
  resources: string
  needs: string
  risks: string
  goal: string
  evaluateBy: string
  interventions: IvInput[]
  aiInteractionId?: string | null
  /** Stand beim Öffnen (Felder wie AreaSnapshot) für die Konflikterkennung (PRD §32) */
  base?: Record<string, string> | null
}

const AREA_FIELDS = ['situation', 'resources', 'needs', 'risks', 'goal', 'evaluateBy'] as const

function cleanIv(iv: IvInput) {
  const title = iv.title.trim().slice(0, 200)
  if (!title) return { error: 'care.plan.errors.titleRequired' }
  const times = parseTimes(iv.times)
  if (!times || !times.length) return { error: 'care.plan.errors.timesInvalid' }
  if (!IV_CATEGORIES.some((c) => c.value === iv.category)) return { error: 'care.plan.errors.categoryInvalid' }
  const durationMin = Math.round(Number(iv.durationMin))
  if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 480) return { error: 'care.plan.errors.durationInvalid' }
  const weekdays = [...new Set(iv.weekdays.map(Number).filter((d) => d >= 0 && d <= 6))].sort()
  return { data: { title, category: iv.category, times, weekdays: weekdays.length === 7 ? [] : weekdays, durationMin, instructions: iv.instructions.trim().slice(0, 2000) || null } }
}

const txt = (s: string) => s.trim().slice(0, 4000) || null

export async function saveAreaAction(residentId: string, input: AreaInput): Promise<ActionResult<{ version: number }>> {
  return run<{ version: number }>(async () => {
    const { ctx, r } = await load(residentId)
    if (!input.domain || !(await validDomain(ctx, input.domain))) return fail('care.plan.errors.domainRequired', 'domain')
    let evaluateBy: Date | null = null
    if (input.evaluateBy) {
      evaluateBy = parseDateKey(input.evaluateBy)
      if (Number.isNaN(evaluateBy.getTime())) return fail('care.plan.errors.dateInvalid', 'evaluateBy')
    }
    const ivs = []
    for (const iv of input.interventions) {
      const c = cleanIv(iv)
      if (c.error) return fail(c.error)
      ivs.push(c.data!)
    }
    const draft = await ensureDraft(ctx, r)
    const area = await ensureArea(ctx, r, draft.id, input.domain)
    const ai = Boolean(input.aiInteractionId)
    // Konflikterkennung (PRD §32): Bereich zwischenzeitlich von anderer Person geändert → nur eigene Felder übernehmen
    const str = (v: string | null | undefined) => (v ?? '').trim()
    const current = { situation: str(area.situation), resources: str(area.resources), needs: str(area.needs), risks: str(area.risks), goal: str(area.goal), evaluateBy: area.evaluateBy ? dateKey(area.evaluateBy) : '' }
    const mine = { situation: str(input.situation), resources: str(input.resources), needs: str(input.needs), risks: str(input.risks), goal: str(input.goal), evaluateBy: input.evaluateBy || '' }
    const base = input.base ? Object.fromEntries(AREA_FIELDS.map((k) => [k, str(input.base?.[k])])) : null
    const m = mergeEdit(base, current, mine, AREA_FIELDS)
    if (m.conflicts.length) {
      refresh()
      return { ok: false, error: await conflictMessage(ctx, { entityType: 'CarePlanArea', entityId: area.id, actions: ['careplan.area.save'], fields: m.conflicts.map((k) => ctx.t(k === 'evaluateBy' ? 'care.plan.evaluateBy' : 'care.plan.fields.' + k)) }), field: m.conflicts[0] }
    }
    const v = m.data as typeof mine
    if (v.evaluateBy !== mine.evaluateBy) evaluateBy = v.evaluateBy ? parseDateKey(v.evaluateBy) : null
    const data = {
      situation: txt(v.situation), resources: txt(v.resources), needs: txt(v.needs), risks: txt(v.risks), goal: txt(v.goal),
      evaluateBy, ...(ai ? { aiSuggested: true } : {}),
    }
    const before = { situation: area.situation, resources: area.resources, needs: area.needs, risks: area.risks, goal: area.goal, evaluateBy: area.evaluateBy, aiSuggested: area.aiSuggested }
    await db.carePlanArea.update({ where: { id: area.id }, data })
    const createdIvs = []
    for (const iv of ivs) createdIvs.push(await db.intervention.create({ data: { residentId: r.id, areaId: area.id, ...iv, active: false } }))
    const first = await db.carePlanArea.findFirst({ where: { carePlanId: draft.id, evaluateBy: { not: null } }, orderBy: { evaluateBy: 'asc' }, select: { evaluateBy: true } })
    await db.carePlan.update({ where: { id: draft.id }, data: { nextEvaluation: first?.evaluateBy ?? null } })
    if (input.aiInteractionId) await aiFeedback(ctx, input.aiInteractionId, true)
    await audit(ctx, {
      action: 'careplan.area.save', entityType: 'CarePlanArea', entityId: area.id,
      before, after: { ...data, domain: input.domain, addedInterventions: createdIvs.map((i) => ({ id: i.id, title: i.title, times: i.times })), aiAssisted: ai },
      context: { residentId: r.id, carePlanId: draft.id },
    })
    await done(ctx, r, { planId: draft.id, areaId: area.id })
    return { ok: true, data: { version: draft.version } }
  })
}

// ── Massnahmen ──

export async function saveInterventionAction(residentId: string, domain: string, iv: IvInput): Promise<ActionResult<{ version: number }>> {
  return run<{ version: number }>(async () => {
    const { ctx, r } = await load(residentId)
    const c = cleanIv(iv)
    if (c.error) return fail(c.error)
    const draft = await ensureDraft(ctx, r)
    if (iv.id) {
      const existing = await db.intervention.findFirst({ where: { id: iv.id, residentId: r.id, area: { carePlanId: draft.id } } })
      if (!existing) return fail('care.plan.errors.notInDraft')
      await db.intervention.update({ where: { id: existing.id }, data: c.data! })
      await audit(ctx, {
        action: 'careplan.intervention.update', entityType: 'Intervention', entityId: existing.id,
        before: { title: existing.title, category: existing.category, times: existing.times, weekdays: existing.weekdays, durationMin: existing.durationMin, instructions: existing.instructions },
        after: c.data, context: { residentId: r.id, carePlanId: draft.id },
      })
    } else {
      if (!domain || !(await validDomain(ctx, domain))) return fail('care.plan.errors.domainRequired')
      const area = await ensureArea(ctx, r, draft.id, domain)
      const created = await db.intervention.create({ data: { residentId: r.id, areaId: area.id, ...c.data!, active: false } })
      await audit(ctx, { action: 'careplan.intervention.create', entityType: 'Intervention', entityId: created.id, after: c.data, context: { residentId: r.id, carePlanId: draft.id } })
    }
    await done(ctx, r, { planId: draft.id })
    return { ok: true, data: { version: draft.version } }
  })
}

/** Deaktiviert eine Massnahme im Entwurf. Die bisherige Version bleibt unverändert im Archiv. */
export async function deactivateInterventionAction(residentId: string, ivId: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId)
    const iv = await db.intervention.findFirst({ where: { id: ivId, residentId: r.id, area: { carePlan: { status: 'draft' } } }, include: { area: true } })
    if (!iv) return fail('care.plan.errors.notInDraft')
    await db.intervention.delete({ where: { id: iv.id } })
    await audit(ctx, {
      action: 'careplan.intervention.deactivate', entityType: 'Intervention', entityId: iv.id,
      before: { title: iv.title, category: iv.category, times: iv.times, weekdays: iv.weekdays, durationMin: iv.durationMin, instructions: iv.instructions, domain: iv.area?.domain },
      after: null, context: { residentId: r.id, carePlanId: iv.area?.carePlanId },
    })
    await done(ctx, r, { planId: iv.area?.carePlanId })
    return { ok: true, message: 'care.plan.ivRemoved' }
  })
}

// ── Evaluation ──

export async function evaluateAction(residentId: string, areaId: string, text: string, next: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId)
    const area = await db.carePlanArea.findFirst({ where: { id: areaId, carePlan: { residentId: r.id, status: { in: ['active', 'draft'] } } }, include: { carePlan: true } })
    if (!area) return fail('common.notFound')
    const body = text.trim().slice(0, 4000)
    if (!body) return fail('care.plan.errors.evalEmpty', 'text')
    let evaluateBy: Date | null = null
    if (next) {
      evaluateBy = parseDateKey(next)
      if (Number.isNaN(evaluateBy.getTime()) || evaluateBy < startOfDay()) return fail('care.plan.errors.dateInvalid', 'next')
    }
    // Evaluationen werden fortgeschrieben, nie überschrieben: neuester Eintrag zuoberst, mit Datum und Kürzel.
    const stamp = `${fmtDate(new Date(), ctx.locale)} ${ctx.user.initials}`
    const evaluation = `${stamp}: ${body}` + (area.evaluation ? '\n\n' + area.evaluation : '')
    const targets = [area]
    if (area.carePlan.status === 'active') {
      const draftArea = await db.carePlanArea.findFirst({ where: { domain: area.domain, carePlan: { residentId: r.id, status: 'draft' } } })
      if (draftArea) targets.push({ ...draftArea, carePlan: area.carePlan })
    }
    for (const a of targets) {
      await db.carePlanArea.update({ where: { id: a.id }, data: { evaluation: `${stamp}: ${body}` + (a.evaluation ? '\n\n' + a.evaluation : ''), evaluateBy } })
      const dates = (await db.carePlanArea.findMany({ where: { carePlanId: a.carePlanId, evaluateBy: { not: null } }, select: { evaluateBy: true }, orderBy: { evaluateBy: 'asc' }, take: 1 }))
      await db.carePlan.update({ where: { id: a.carePlanId }, data: { nextEvaluation: dates[0]?.evaluateBy ?? null } })
    }
    // Fällige Evaluations-Aufgaben dieses Bereichs gelten damit als erledigt (PRD §9.2, Document Once).
    const closed = await db.task.updateMany({
      where: { residentId: r.id, source: 'careplan', sourceId: `eval:${r.id}:${area.domain}`, status: { in: [...OPEN_STATUSES] }, dueAt: { lt: addDays(startOfDay(), 1) } },
      data: { status: 'done', completedById: ctx.user.id, completedAt: new Date() },
    })
    // Frühere Termine, die durch das neue Datum ersetzt sind, entfallen.
    await db.task.deleteMany({ where: { residentId: r.id, source: 'careplan', sourceId: `eval:${r.id}:${area.domain}`, status: { in: ['planned', 'ready'] }, dueAt: { gte: addDays(startOfDay(), 1) } } })
    await audit(ctx, {
      action: 'careplan.evaluate', entityType: 'CarePlanArea', entityId: area.id,
      before: { evaluation: area.evaluation, evaluateBy: area.evaluateBy }, after: { evaluation, evaluateBy },
      context: { residentId: r.id, carePlanId: area.carePlanId, tasksCompleted: closed.count },
    })
    await done(ctx, r, { areaId: area.id, step: 'evaluated' })
    return { ok: true, message: 'care.plan.evaluationSaved' }
  })
}

// ── Smart Suggestions ──

export async function acceptSuggestionAction(residentId: string, ruleKey: string, sourceId: string): Promise<ActionResult<{ version: number }>> {
  return run<{ version: number }>(async () => {
    const { ctx, r } = await load(residentId)
    const rule = SUGGESTION_RULES[ruleKey]
    if (!rule) return fail('common.notFound')
    const draft = await ensureDraft(ctx, r)
    const area = await ensureArea(ctx, r, draft.id, rule.domain)
    const data = {
      title: ctx.t(`care.suggest.rule.${rule.key}.title`), instructions: ctx.t(`care.suggest.rule.${rule.key}.text`),
      category: rule.category, times: rule.times, weekdays: rule.weekdays, durationMin: rule.durationMin,
    }
    const iv = await db.intervention.create({ data: { residentId: r.id, areaId: area.id, ...data, active: false } })
    await audit(ctx, {
      action: 'careplan.suggestion.accept', entityType: 'CarePlanSuggestion', entityId: `${r.id}:${rule.key}:${sourceId}`,
      after: { interventionId: iv.id, ...data, rule: rule.key, sourceId }, context: { residentId: r.id, carePlanId: draft.id },
    })
    await done(ctx, r, { planId: draft.id, suggestion: rule.key })
    return { ok: true, data: { version: draft.version } }
  })
}

export async function dismissSuggestionAction(residentId: string, ruleKey: string, sourceId: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId)
    if (!SUGGESTION_RULES[ruleKey]) return fail('common.notFound')
    await audit(ctx, {
      action: 'careplan.suggestion.dismiss', entityType: 'CarePlanSuggestion', entityId: `${r.id}:${ruleKey}:${sourceId}`,
      after: { rule: ruleKey, sourceId }, context: { residentId: r.id },
    })
    refresh()
    return { ok: true, message: 'care.suggest.dismissed' }
  })
}

// ── CareOS AI: Planungsassistent (PRD §23.1) ──

export type AiAreaDraft = { id: string; situation: string; resources: string; needs: string; risks: string; goal: string; interventions: IvInput[]; raw: string }

const SECTION: Record<string, keyof Omit<AiAreaDraft, 'id' | 'interventions' | 'raw'> | 'interventions'> = {
  SITUATION: 'situation', RESOURCES: 'resources', NEEDS: 'needs', RISKS: 'risks', GOAL: 'goal', INTERVENTIONS: 'interventions',
}

function parseAi(text: string): Omit<AiAreaDraft, 'id' | 'raw'> {
  const out = { situation: '', resources: '', needs: '', risks: '', goal: '', interventions: [] as IvInput[] }
  let cur: string | null = null
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z]+)\s*:\s*(.*)$/.exec(line)
    if (m && SECTION[m[1]]) {
      cur = SECTION[m[1]]
      if (cur !== 'interventions' && m[2]) out[cur as 'situation'] = m[2].trim()
      continue
    }
    if (!cur || !line.trim()) continue
    if (cur === 'interventions') {
      const [title, category, times] = line.replace(/^\s*[-•*]\s*/, '').split('|').map((s) => s.trim())
      if (!title) continue
      const cat = IV_CATEGORIES.find((c) => c.value.toLowerCase() === (category ?? '').toLowerCase())?.value ?? 'Grundpflege'
      out.interventions.push({ title: title.slice(0, 200), category: cat, times: parseTimes(times ?? '')?.join(', ') || '08:00', weekdays: [], durationMin: 10, instructions: '' })
    } else {
      out[cur as 'situation'] = (out[cur as 'situation'] ? out[cur as 'situation'] + '\n' : '') + line.trim()
    }
  }
  out.interventions = out.interventions.slice(0, 6)
  return out
}

export async function aiAreaDraftAction(residentId: string, domain: string, current: Omit<AreaInput, 'interventions' | 'evaluateBy' | 'domain'>): Promise<ActionResult<AiAreaDraft>> {
  return run<AiAreaDraft>(async () => {
    const { ctx, r } = await load(residentId)
    if (!aiConfigured()) return fail('common.ai.unavailable')
    const [assessments, wounds, profile] = await Promise.all([
      db.assessment.findMany({ where: { residentId: r.id, ...LIVE }, orderBy: { at: 'desc' }, take: 12 }),
      db.wound.findMany({ where: { residentId: r.id, status: { not: 'closed' } } }),
      db.nutritionProfile.findUnique({ where: { residentId: r.id } }),
    ])
    const seen = new Set<string>()
    const latest = assessments.filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)))
    const input = [
      `Pflegebereich: ${domainLabel(ctx.t, domain)}`,
      `Mobilität: ${r.mobility ?? '–'}`, `Kostform: ${r.diet ?? '–'}`, `Risiken: ${r.risks.join(', ') || '–'}`, `Allergien: ${r.allergies.join(', ') || '–'}`,
      `Assessments: ${latest.map((a) => `${a.key} ${a.score ?? ''} (${a.result ?? ''})`).join('; ') || '–'}`,
      `Offene Wunden: ${wounds.map((w) => `${w.kind} ${w.bodySite}`).join('; ') || '–'}`,
      profile ? `Ernährung: ${[profile.texture, profile.swallowing, profile.supplements].filter(Boolean).join(', ') || '–'}` : '',
      `Bisherige Angaben: Situation: ${current.situation || '–'} | Ressourcen: ${current.resources || '–'} | Bedarf: ${current.needs || '–'} | Risiken: ${current.risks || '–'} | Ziel: ${current.goal || '–'}`,
    ].filter(Boolean).join('\n')
    const instruction = `Erstelle einen Entwurf für einen Pflegebereich der Pflegeplanung. Ergänze und präzisiere die bisherigen Angaben nur auf Basis des Inputs.
Antworte exakt in diesem Format, die Bezeichnungen vor dem Doppelpunkt unverändert in Grossbuchstaben:
SITUATION: …
RESOURCES: …
NEEDS: …
RISKS: …
GOAL: … (konkret, überprüfbar)
INTERVENTIONS:
- Titel | Kategorie | HH:MM, HH:MM
Kategorie ist genau einer dieser Werte: ${IV_CATEGORIES.map((c) => c.value).join(', ')}. Höchstens 5 Massnahmen, keine Medikamente oder Dosierungen.`
    try {
      const res = await aiDraft(ctx, 'careplan', instruction, input, 1200)
      return { ok: true, data: { id: res.id, raw: res.text, ...parseAi(res.text) } }
    } catch (e) {
      if (e instanceof AiUnavailable) return fail(e.message === 'forbidden' ? 'common.notAllowed' : 'care.plan.aiError')
      throw e
    }
  })
}

export async function aiDiscardAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    await aiFeedback(ctx, id, false)
  })
}
