'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, type ActionResult } from '@/lib/action'
import { emergencySchema } from '@/lib/emergency-core'
import { activeEmergency, endEmergency, startEmergency } from '@/lib/emergency'
import { formObject } from '@/lib/registration-core'

/** Notfallzugriff starten (PRD §34/§37). Nur mit admin.emergency und ohne eigene klinische Leserechte. */
export async function startEmergencyAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.emergency')
    if (ctx.emergency) return { ok: false, error: 'tenancy.emergency.already' }
    if (ctx.can('resident.read')) return { ok: false, error: 'tenancy.emergency.notAvailable' }
    const d = emergencySchema.parse(formObject(form))
    const a = await startEmergency(ctx, d.reason, d.minutes)
    if (!a) return { ok: false, error: 'tenancy.emergency.already' }
    refresh()
    return { ok: true, message: 'tenancy.emergency.started' }
  })
}

/**
 * Notfallzugriff beenden: die Person selbst (ohne id: der eigene laufende Zugriff) oder Pflegedienstleitung/Datenschutz
 * (admin.audit) für andere Personen.
 */
export async function endEmergencyAction(id?: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const target = id ? await db.emergencyAccess.findFirst({ where: { id, orgId: ctx.org.id } }) : await activeEmergency(ctx.user.id)
    if (!target) return { ok: false, error: 'common.notFound' }
    if (target.userId !== ctx.user.id) assertCan(ctx, 'admin.audit')
    await endEmergency(ctx, target.id)
    refresh()
    return { ok: true, message: 'tenancy.emergency.ended' }
  })
}
