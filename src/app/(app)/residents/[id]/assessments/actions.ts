'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ForbiddenError, getCtx, residentInScope } from '@/lib/context'
import { run, type ActionResult } from '@/lib/action'
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
