'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { orgSettings } from '@/lib/admin'
import { ACK_KEYS, ackSettings, type AckSettings } from '@/lib/acks'

/** Admin → Klinische Konfiguration → Bestätigungen (PRD §45 Workflow). */
export async function saveAckSettingsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    // Aktuellen Stand frisch lesen, damit parallele Änderungen anderer Einstellungen erhalten bleiben.
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const settings = orgSettings(org.settings)
    const before = ackSettings(settings)
    const acks = Object.fromEntries(ACK_KEYS.map((k) => [k, fdBool(form, k)])) as AckSettings
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...settings, acks } as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'admin.config.acks', entityType: 'Organization', entityId: ctx.org.id, before, after: acks })
    refresh()
  })
}
