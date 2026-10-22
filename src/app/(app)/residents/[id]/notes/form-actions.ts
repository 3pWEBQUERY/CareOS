'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { formSummary, readFields, structuredSnapshot, validateFormValues } from '@/lib/forms'
import { ackSettings, OBSERVATION_ACK } from '@/lib/acks'
import { actionResident } from '../../_lib/resident'

/**
 * Fokusdokumentation mit Formular (PRD §10.3): speichert einen Verlaufseintrag mit
 * structured = { formKey, formVersion, formName, values, labels, order } und lesbarer Zusammenfassung.
 */
export async function createFormEntry(
  residentId: string,
  input: { formId: string; version: number; values: Record<string, unknown>; important: boolean },
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.chart.write')
    const def = await db.formDefinition.findFirst({ where: { id: String(input.formId ?? ''), orgId: ctx.org.id, active: true } })
    if (!def) return { ok: false, error: 'forms.errors.notAvailable' }
    // Formular wurde zwischenzeitlich geändert: nicht gegen eine andere Version speichern.
    if (def.version !== Number(input.version)) return { ok: false, error: 'forms.errors.changed' }
    const fields = readFields(def.fields)
    if (!fields.length) return { ok: false, error: 'forms.errors.notAvailable' }
    const raw = input.values && typeof input.values === 'object' ? input.values : {}
    const v = validateFormValues(fields, raw)
    if (!v.ok) return { ok: false, error: 'forms.errors.invalid', field: Object.keys(v.errors)[0] }
    const words = { yes: ctx.t('common.yes'), no: ctx.t('common.no') }
    const text = formSummary(def.name, fields, v.values, words).slice(0, 8000)
    const structured = structuredSnapshot({ key: def.key, version: def.version, name: def.name }, fields, v.values)
    const important = input.important === true
    const obs = await db.observation.create({
      data: { residentId: r.id, category: def.category, text, important, authorId: ctx.user.id, source: 'manual', structured: structured as unknown as Prisma.InputJsonValue },
    })
    await audit(ctx, {
      action: 'observation.create', entityType: 'Observation', entityId: obs.id,
      after: { category: obs.category, text: obs.text, important, source: obs.source, form: { key: def.key, version: def.version }, values: v.values },
      context: { residentId: r.id },
    })
    await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { observationId: obs.id, category: obs.category, important, formKey: def.key } })
    refresh()
    return { ok: true, data: { id: obs.id } }
  })
}

/** Kenntnisnahme eines wichtigen Verlaufseintrags (Admin → Bestätigungen, PRD §45). */
export async function acknowledgeObservation(residentId: string, observationId: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.read')
    if (!ackSettings(ctx.org.settings).residentImportantNoteRequiresAck) return { ok: false, error: 'common.notAllowed' }
    const obs = await db.observation.findFirst({ where: { id: observationId, residentId: r.id, important: true }, select: { id: true, authorId: true } })
    if (!obs) return { ok: false, error: 'common.notFound' }
    if (obs.authorId === ctx.user.id) return { ok: true }
    const res = await db.acknowledgement.createMany({ data: [{ userId: ctx.user.id, subjectType: OBSERVATION_ACK, subjectId: obs.id, version: '' }], skipDuplicates: true })
    if (res.count) await audit(ctx, { action: 'observation.acknowledge', entityType: 'Observation', entityId: obs.id, context: { residentId: r.id } })
    refresh()
    return { ok: true, message: 'forms.ack.done' }
  })
}
