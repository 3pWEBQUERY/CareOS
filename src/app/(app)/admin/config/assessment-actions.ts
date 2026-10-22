'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { slugKey } from '@/lib/admin-shared'
import { ASSESSMENTS } from '@/lib/clinical-config'
import { AssessmentDraft, rangeProblem, toItems } from '@/lib/assessment-builder'
import { invalidateTaskGeneration } from '@/lib/tasks'

const STD = new Set(ASSESSMENTS.map((a) => a.key))

/** Wurde das Instrument in dieser Organisation schon verwendet? Dann sind Fragen und Bewertung gesperrt. */
async function used(orgId: string, key: string) {
  return (await db.assessment.count({ where: { key, resident: { orgId } } })) > 0
}

/**
 * Eigenes Assessment-Instrument anlegen oder (solange unbenutzt) ändern (PRD §45).
 * Standardinstrumente (Braden, MNA-SF …) sind validiert und bleiben in Fragen und Bewertung unverändert.
 */
export async function saveAssessmentDefinitionAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    let raw: unknown
    try {
      raw = JSON.parse(fd(form, 'def') || '{}')
    } catch {
      return { ok: false, error: 'common.genericError' }
    }
    const parsed = AssessmentDraft.safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message.startsWith('forms.') ? parsed.error.issues[0].message : 'common.genericError' }
    const d = parsed.data
    const problem = rangeProblem(d.questions, d.ranges)
    if (problem) return { ok: false, error: problem }
    const items = toItems(d) as unknown as Prisma.InputJsonValue
    const id = fd(form, 'id')
    if (id) {
      const before = await db.assessmentDefinition.findFirst({ where: { id, orgId: ctx.org.id } })
      if (!before) return { ok: false, error: 'common.notFound' }
      if (STD.has(before.key) || (await used(ctx.org.id, before.key))) return { ok: false, error: 'forms.assessment.errors.locked' }
      await db.assessmentDefinition.update({ where: { id }, data: { name: d.name, description: d.description || null, intervalDays: d.intervalDays, items } })
      await audit(ctx, { action: 'admin.config.assessment_definition', entityType: 'AssessmentDefinition', entityId: id, before: { name: before.name, description: before.description, intervalDays: before.intervalDays, items: before.items }, after: { name: d.name, description: d.description, intervalDays: d.intervalDays, items } })
    } else {
      // Ohne gespeicherte Definitionen gelten die Standardinstrumente: zuerst übernehmen, sonst verschwinden sie.
      if (!(await db.assessmentDefinition.count({ where: { orgId: ctx.org.id } }))) {
        await db.assessmentDefinition.createMany({ data: ASSESSMENTS.map((a) => ({ orgId: ctx.org.id, key: a.key, name: a.name, description: a.description, items: a.items as unknown as Prisma.InputJsonValue, intervalDays: a.intervalDays })) })
      }
      const base = slugKey(d.name) || 'assessment'
      let key = base
      for (let i = 2; STD.has(key) || (await db.assessmentDefinition.findUnique({ where: { orgId_key: { orgId: ctx.org.id, key } } })); i++) key = `${base}_${i}`
      const created = await db.assessmentDefinition.create({ data: { orgId: ctx.org.id, key, name: d.name, description: d.description || null, intervalDays: d.intervalDays, items, active: true } })
      await audit(ctx, { action: 'admin.config.assessment_definition_create', entityType: 'AssessmentDefinition', entityId: created.id, after: { key, name: d.name, description: d.description, intervalDays: d.intervalDays, items } })
    }
    invalidateTaskGeneration()
    refresh()
    return { ok: true, message: id ? 'common.saved' : 'forms.assessment.created' }
  })
}
