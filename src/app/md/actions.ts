'use server'

import { refresh } from 'next/cache'
import { run, type ActionResult } from '@/lib/action'
import { mdActionResident } from '@/lib/md/context'
import { completeVisitCore, type CompleteVisitInput } from '@/lib/visit-complete'
import { confirmOrder, gateDto, interactionGate, saveOrder, stopOrder, type GateDto } from '@/lib/medication-orders'
import { parseCodes } from '@/lib/medication-codes'

/**
 * Server Actions des Ärzteportals. Jede Action lädt die Person über `mdActionResident` (aktive Zuordnung,
 * Portalrecht) – nie über getCtx/residentInScope der Stationsapp.
 */
const str = (form: FormData, k: string) => { const v = form.get(k); return typeof v === 'string' ? v.trim() : '' }

/** Asynchrone Visite: Fragen beantworten, Anordnungen (→ Aufgaben für die Pflege), Notiz. */
export async function mdCompleteVisit(residentId: string, input: CompleteVisitInput): Promise<ActionResult<{ visitId: string; tasks: number }>> {
  return run(async () => {
    const { md, r } = await mdActionResident(residentId, 'resident.visit.conduct')
    const res = await completeVisitCore(md, r, input, { physicianId: md.user.id, physicianName: `${md.user.firstName} ${md.user.lastName}`, portal: true })
    if (res.ok) refresh()
    return res
  })
}

export async function mdSaveOrder(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { md, r } = await mdActionResident(str(form, 'residentId'), 'resident.medication.edit')
    const res = await saveOrder(md, r, form, { canPrescribe: true, canPhone: false, external: true })
    if (res.ok) refresh()
    return res.ok ? { ok: true, message: res.message } : res
  }) as Promise<ActionResult>
}

export async function mdStopOrder(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { md, r } = await mdActionResident(str(form, 'residentId'), 'resident.medication.edit')
    const res = await stopOrder(md, r, str(form, 'id'), str(form, 'reason'))
    if (res.ok) refresh()
    return res
  })
}

/** Visum für telefonische/mündliche Verordnungen der Pflege. */
export async function mdConfirmOrder(medicationId: string): Promise<ActionResult> {
  return run(async () => {
    const { db } = await import('@/lib/db')
    const med = await db.medication.findUnique({ where: { id: String(medicationId) }, select: { residentId: true } })
    if (!med) return { ok: false, error: 'common.notFound' }
    const { md, r } = await mdActionResident(med.residentId, 'resident.medication.edit')
    const res = await confirmOrder(md, r, String(medicationId), true)
    if (res.ok) refresh()
    return res
  })
}

export async function mdPreviewInteractions(residentId: string, draft: { name: string; atc: string; gtin: string; replacesId: string | null }): Promise<ActionResult<GateDto>> {
  return run<GateDto>(async () => {
    const { md, r } = await mdActionResident(residentId, 'resident.medication.edit')
    const name = String(draft.name ?? '').trim().slice(0, 200)
    if (name.length < 2) return { ok: true, data: { level: 'clear', source: null, needsReason: false, hits: [] } }
    const codes = parseCodes({ atc: String(draft.atc ?? ''), gtin: String(draft.gtin ?? '') })
    const g = await interactionGate(md.org.id, r.id, { name, atc: codes.atc, gtin: codes.gtin }, typeof draft.replacesId === 'string' ? draft.replacesId : null, md.locale)
    return { ok: true, data: gateDto(g) }
  })
}
