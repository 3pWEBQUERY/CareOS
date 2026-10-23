'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { orgSettings } from '@/lib/admin'
import { RETENTION_CATEGORIES, RETENTION_RULES, retentionPolicy, type RetentionPolicy } from '@/lib/retention-policy'
import { recordRun, withJobLock } from '@/lib/jobs'
import { runRetention } from '@/lib/retention'
import { PORTAL_RETENTION_KEYS } from '@/lib/portal/retention'

export async function saveRetentionAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    const next = { auto: fdBool(form, 'auto') } as RetentionPolicy
    for (const c of RETENTION_CATEGORIES) {
      const r = RETENTION_RULES[c]
      const n = Number(fd(form, c))
      if (!fd(form, c) || !Number.isInteger(n) || n < r.min || n > r.max)
        return { ok: false, error: ctx.t('admin.privacy.errors.range', { label: ctx.t('admin.privacy.cat.' + c), min: r.min, max: r.max, unit: ctx.t('admin.privacy.units.' + r.unit) }), field: c }
      next[c] = n
    }
    // Aktuelle Einstellungen frisch lesen, damit parallele Änderungen anderer Bereiche nicht verloren gehen.
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const before = retentionPolicy(org.settings)
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...orgSettings(org.settings), retention: next } as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'admin.privacy.retention', entityType: 'Organization', entityId: ctx.org.id, before, after: next })
    refresh()
  })
}

export async function runRetentionNowAction(): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    const r = await withJobLock('retention', () =>
      recordRun('retention', { orgId: ctx.org.id, trigger: 'manual', actorId: ctx.user.id }, () => runRetention(ctx.org.id, { actorId: ctx.user.id, trigger: 'manual' })),
    )
    if (!r.locked) return { ok: false, error: 'admin.privacy.busy' }
    refresh()
    if (!r.value.ok) return { ok: false, error: ctx.t('admin.privacy.failed', { error: r.value.error.slice(0, 160) }) }
    const c = r.value.value
    // Portal-Daten zählen mit (Kommunikation, Sitzungen, verwaiste Konten und Einladungen)
    const portal = PORTAL_RETENTION_KEYS.reduce((s, k) => s + (c[k] ?? 0), 0)
    const n = RETENTION_CATEGORIES.reduce((s, k) => s + c[k], 0) + portal
    return { ok: true, message: ctx.t('admin.privacy.runDone', { n }) }
  })
}
