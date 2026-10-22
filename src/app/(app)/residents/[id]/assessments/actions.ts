'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ForbiddenError, getCtx, residentInScope } from '@/lib/context'
import { fd, run, type ActionResult } from '@/lib/action'
import { actionResident } from '../../_lib/resident'
import { AlreadyVoided, correctionSchema, mayCorrect, voidData } from '../../_lib/correction'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { invalidateTaskGeneration, OPEN_STATUSES } from '@/lib/tasks'
import { addDays, startOfDay } from '@/lib/time'
import { scoreAssessment } from '@/lib/clinical-config'
import { loadAssessmentDefs } from './defs'

export async function saveAssessmentAction(residentId: string, key: string, answers: Record<string, number>): Promise<ActionResult<{ level: string }>> {
  return run<{ level: string }>(async () => {
    const ctx = await getCtx()
    const r = await residentInScope(ctx, residentId, 'resident.assessment.write')
    if (!r) throw new ForbiddenError('resident.assessment.write')
    const def = (await loadAssessmentDefs(ctx.org.id)).find((d) => d.key === key)
    if (!def) return { ok: false, error: 'care.assessments.errors.unknown' }
    // Nur gültige Antworten der Definition übernehmen.
    const clean: Record<string, number> = {}
    for (const q of def.items.questions) {
      const v = Number(answers[q.key])
      if (!q.options.some((o) => o.v === v)) return { ok: false, error: 'care.assessments.errors.incomplete' }
      clean[q.key] = v
    }
    const { score, result, level } = scoreAssessment(def, clean)
    const now = new Date()
    const nextDue = def.intervalDays ? addDays(now, def.intervalDays) : null
    const a = await db.assessment.create({
      data: { residentId: r.id, key, score, result, answers: clean as Prisma.InputJsonValue, authorId: ctx.user.id, at: now, nextDue },
    })
    // Fällige Assessment-Aufgabe von heute gilt damit als erledigt.
    await db.task.updateMany({
      where: { residentId: r.id, source: 'assessment', sourceId: `${r.id}:${key}`, status: { in: [...OPEN_STATUSES] }, dueAt: { lt: addDays(startOfDay(now), 1) } },
      data: { status: 'done', completedById: ctx.user.id, completedAt: now },
    })
    await audit(ctx, {
      action: 'assessment.record', entityType: 'Assessment', entityId: a.id,
      after: { key, score, result, level, answers: clean, nextDue }, context: { residentId: r.id },
    })
    await emit({ orgId: ctx.org.id, type: 'assessment.recorded', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { key, score, level } })
    invalidateTaskGeneration(r.unitId)
    refresh()
    return { ok: true, data: { level } }
  })
}

/**
 * Storno oder Korrektur eines Assessments (PRD §35). Die Korrektur übernimmt den ursprünglichen Zeitpunkt und
 * berechnet die nächste Fälligkeit ab diesem Zeitpunkt; ein reiner Storno macht die vorherige gültige Beurteilung
 * wieder massgebend (inkl. deren Fälligkeit).
 */
export async function correctAssessmentAction(residentId: string, assessmentId: string, form: FormData): Promise<ActionResult<{ level?: string }>> {
  return run<{ level?: string }>(async () => {
    const { mode, reason } = correctionSchema.parse({ mode: fd(form, 'mode'), reason: fd(form, 'reason') })
    const { ctx, r, can } = await actionResident(residentId, 'resident.assessment.write')
    const old = await db.assessment.findFirst({ where: { id: assessmentId, residentId: r.id } })
    if (!old) return { ok: false, error: 'common.notFound' }
    if (!mayCorrect(ctx, can, old.authorId)) return { ok: false, error: 'common.notAllowed' }
    if (old.voidedAt) return { ok: false, error: 'chart.void.errors.already' }
    let next: { score: number; result: string; level: string; answers: Record<string, number>; nextDue: Date | null } | null = null
    if (mode === 'correct') {
      const def = (await loadAssessmentDefs(ctx.org.id)).find((d) => d.key === old.key)
      if (!def) return { ok: false, error: 'care.assessments.errors.unknown' }
      const clean: Record<string, number> = {}
      for (const q of def.items.questions) {
        const v = Number(fd(form, 'q_' + q.key))
        if (!fd(form, 'q_' + q.key) || !q.options.some((o) => o.v === v)) return { ok: false, error: 'care.assessments.errors.incomplete', field: 'q_' + q.key }
        clean[q.key] = v
      }
      const prev = (old.answers ?? {}) as Record<string, number>
      if (def.items.questions.every((q) => prev[q.key] === clean[q.key])) return { ok: false, error: 'chart.void.errors.unchanged' }
      const s = scoreAssessment(def, clean)
      next = { ...s, answers: clean, nextDue: def.intervalDays ? addDays(old.at, def.intervalDays) : null }
    }
    let created: { id: string } | null = null
    try {
      created = await db.$transaction(async (tx) => {
        const res = await tx.assessment.updateMany({ where: { id: old.id, voidedAt: null }, data: voidData(ctx, reason) })
        if (res.count !== 1) throw new AlreadyVoided()
        if (!next) return null
        return tx.assessment.create({
          data: { residentId: r.id, key: old.key, at: old.at, score: next.score, result: next.result, answers: next.answers as Prisma.InputJsonValue, authorId: ctx.user.id, nextDue: next.nextDue, supersedesId: old.id },
          select: { id: true },
        })
      })
    } catch (e) {
      if (e instanceof AlreadyVoided) return { ok: false, error: 'chart.void.errors.already' }
      throw e
    }
    await audit(ctx, {
      action: created ? 'assessment.correct' : 'assessment.void', entityType: 'Assessment', entityId: old.id,
      before: { key: old.key, at: old.at, score: old.score, result: old.result, answers: old.answers, authorId: old.authorId, nextDue: old.nextDue },
      after: { voided: true, reason, ...(created && next ? { correctionId: created.id, score: next.score, result: next.result, answers: next.answers, nextDue: next.nextDue } : {}) },
      context: { residentId: r.id },
    })
    await emit({ orgId: ctx.org.id, type: 'assessment.corrected', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { key: old.key, assessmentId: old.id, correctionId: created?.id ?? null, level: next?.level ?? null } })
    invalidateTaskGeneration(r.unitId)
    refresh()
    return { ok: true, data: { level: next?.level }, message: created ? 'chart.void.corrected' : 'chart.void.voided' }
  })
}
