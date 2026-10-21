'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { getCtx } from '@/lib/context'
import { aiDraft, aiFeedback, AiUnavailable } from '@/lib/ai'
import { actionResident, OBS_CATEGORIES } from '../../_lib/resident'

const noteSchema = z.object({
  category: z.enum(OBS_CATEGORIES, { message: 'chart.notes.errors.category' }),
  text: z.string().trim().min(3, 'chart.notes.errors.empty').max(8000, 'chart.notes.errors.long'),
  important: z.boolean(),
  source: z.enum(['manual', 'voice', 'ai']),
  aiId: z.string().max(40).nullish(),
})

export type NoteInput = z.input<typeof noteSchema>

export async function createNote(residentId: string, input: NoteInput): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const data = noteSchema.parse(input)
    const { ctx, r } = await actionResident(residentId, 'resident.chart.write')
    const obs = await db.observation.create({
      data: {
        residentId: r.id, category: data.category, text: data.text, important: data.important, authorId: ctx.user.id,
        source: data.source, aiAssisted: !!data.aiId || data.source === 'ai',
      },
    })
    if (data.aiId) await aiFeedback(ctx, data.aiId, true)
    await audit(ctx, { action: 'observation.create', entityType: 'Observation', entityId: obs.id, after: { category: obs.category, text: obs.text, important: obs.important, source: obs.source, aiAssisted: obs.aiAssisted }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { observationId: obs.id, category: obs.category, important: obs.important } })
    refresh()
    return { ok: true, data: { id: obs.id } }
  })
}

const corrSchema = z.object({
  text: z.string().trim().min(3, 'chart.notes.errors.empty').max(8000, 'chart.notes.errors.long'),
  reason: z.string().trim().min(3, 'chart.notes.errors.reason').max(500),
})

/** Korrektur (PRD §35): neuer Eintrag mit supersedesId, der alte bleibt unverändert erhalten. */
export async function correctNote(residentId: string, observationId: string, input: { text: string; reason: string }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const data = corrSchema.parse(input)
    const { ctx, r, can } = await actionResident(residentId, 'resident.chart.write')
    const old = await db.observation.findFirst({ where: { id: observationId, residentId: r.id }, include: { correctedBy: { select: { id: true } } } })
    if (!old) return { ok: false, error: 'common.notFound' }
    if (old.authorId !== ctx.user.id && !can('resident.chart.correct')) return { ok: false, error: 'common.notAllowed' }
    if (old.correctedBy.length) return { ok: false, error: 'chart.notes.errors.alreadyCorrected' }
    const obs = await db.observation.create({
      data: {
        residentId: r.id, category: old.category, at: old.at, text: data.text, important: old.important, authorId: ctx.user.id,
        source: 'manual', supersedesId: old.id, taskId: old.taskId, structured: { correctionReason: data.reason },
      },
    })
    await audit(ctx, {
      action: 'observation.correct', entityType: 'Observation', entityId: old.id,
      before: { text: old.text, authorId: old.authorId }, after: { text: obs.text, correctionId: obs.id, reason: data.reason },
      context: { residentId: r.id },
    })
    await emit({ orgId: ctx.org.id, type: 'observation.corrected', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { observationId: obs.id, supersedesId: old.id } })
    refresh()
    return { ok: true, data: { id: obs.id } }
  })
}

const AI_INSTRUCTION = `Aufgabe: Formuliere aus den Stichworten einer Pflegefachperson einen Eintrag für den Pflegebericht.
Struktur, soweit im Input vorhanden: Beobachtung – Massnahme – Wirkung/Reaktion – Hinweis für die nächste Schicht.
Fliesstext in kurzen Sätzen, höchstens 6 Sätze, keine Überschriften. Nichts hinzufügen, was nicht in den Stichworten steht.`

/** Dokumentationsassistent (PRD §23.1): Stichworte → strukturierter Entwurf. Wird nie automatisch gespeichert. */
export async function draftNote(residentId: string, input: { text: string; category: string }): Promise<ActionResult<{ id: string; text: string }>> {
  return run(async () => {
    const text = input.text.trim()
    if (text.length < 3) return { ok: false, error: 'chart.notes.errors.aiEmpty' }
    const { ctx } = await actionResident(residentId, 'resident.chart.write')
    try {
      const cat = OBS_CATEGORIES.includes(input.category as (typeof OBS_CATEGORIES)[number]) ? ctx.t('chart.cat.' + input.category) : ''
      const res = await aiDraft(ctx, 'documentation', AI_INSTRUCTION, `Kategorie: ${cat}\nStichworte:\n${text.slice(0, 4000)}`, 800)
      return { ok: true, data: res }
    } catch (e) {
      if (e instanceof AiUnavailable) return { ok: false, error: 'common.ai.unavailable' }
      throw e
    }
  })
}

export async function discardDraft(aiId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    await aiFeedback(ctx, aiId, false)
  })
}
