'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { orgSettings } from '@/lib/admin'
import { customVitals, normalizeCustom } from '@/lib/vitals-custom'

/**
 * Organisationseigene Vitalparameter speichern (PRD §45, Klinische Konfiguration). Bereits erfasste Werte bleiben
 * erhalten; ein entfernter Parameter wird nur nicht mehr angeboten.
 */
export async function saveCustomVitals(defs: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    const r = normalizeCustom(defs)
    if (!r.ok) return { ok: false, error: ctx.t(r.error, { n: (r.index ?? 0) + 1 }) }
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const settings = orgSettings(org.settings)
    const before = customVitals(settings)
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...settings, customVitals: r.defs } as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'admin.config.customVitals', entityType: 'Organization', entityId: ctx.org.id, before, after: r.defs })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', actorId: ctx.user.id, payload: { customVitals: true } })
    refresh()
    return { ok: true, message: 'chart.custom.saved' }
  })
}
