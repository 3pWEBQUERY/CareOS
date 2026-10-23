'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { completeVisitCore, type CompleteVisitInput } from '@/lib/visit-complete'
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
    if (!ctx.hasModule('visit')) return { ok: false, error: 'common.moduleOff' }
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
    if (!ctx.hasModule('visit')) return { ok: false, error: 'common.moduleOff' }
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

export type { CompleteVisitInput } from '@/lib/visit-complete'

/**
 * Complete (PRD §49): Visite einer Person abschliessen (Logik in src/lib/visit-complete.ts). Dokumentiert eine Person
 * mit Verordnungsrecht (Ärztin/Arzt), wird ihr Konto an der Visite vermerkt.
 */
export async function completeVisit(residentId: string, input: CompleteVisitInput): Promise<ActionResult<{ visitId: string; tasks: number }>> {
  return run(async () => {
    const { ctx, r, can } = await actionResident(residentId, 'resident.visit.conduct')
    const res = await completeVisitCore(ctx, r, input, { physicianId: can('resident.medication.edit') ? ctx.user.id : null })
    if (res.ok) refresh()
    return res
  })
}
