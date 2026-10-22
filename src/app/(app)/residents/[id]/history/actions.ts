'use server'

import { refresh } from 'next/cache'
import { getCtx, assertCan, residentInScope } from '@/lib/context'
import { run, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { anonymiseResident } from '@/lib/retention'

/**
 * Manuelle Anonymisierung einer ausgetretenen oder verstorbenen Person (Löschkonzept, PRD §36).
 * Nur mit admin.org und ausdrücklicher Bestätigung. Das Audit enthält bewusst keine Personendaten.
 */
export async function anonymiseResidentAction(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    const r = await residentInScope(ctx, residentId)
    if (!r) return { ok: false, error: 'common.notFound' }
    if (r.status !== 'discharged' && r.status !== 'deceased') return { ok: false, error: 'residents.dataRights.errors.active' }
    if (!fdBool(form, 'confirm')) return { ok: false, error: 'residents.dataRights.errors.confirm', field: 'confirm' }
    const f = await anonymiseResident(r.id)
    await audit(ctx, {
      action: 'resident.anonymise', entityType: 'Resident', entityId: r.id,
      before: { status: r.status, dischargedAt: r.dischargedAt, anonymisedAt: r.anonymisedAt },
      after: { anonymised: !f.failed },
      context: { residentId: r.id, trigger: 'manual', filesDeleted: f.deleted, filesFailed: f.failed },
    })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { anonymised: true } })
    refresh()
    if (f.failed) return { ok: false, error: 'residents.dataRights.errors.files' }
    return { ok: true, message: 'residents.dataRights.done' }
  })
}
