'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { randomToken } from '@/lib/crypto'
import { hashToken } from '@/lib/auth/session'
import { personalTokenSchema, scopesBeyond, tokenExpiry } from '@/lib/api-tokens'

const MAX_ACTIVE = 10

/**
 * Persönliches API-Token (Developer-Portal, PRD §60): Ablaufdatum Pflicht, Scopes nur innerhalb der eigenen,
 * organisationsweiten Berechtigungen (keine Rechteausweitung). Notfallzugriff zählt nicht.
 */
export async function createPersonalTokenAction(form: FormData): Promise<ActionResult<{ secret: string }>> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'api.personal')
    const d = personalTokenSchema.parse({ name: fd(form, 'name'), days: fd(form, 'days'), scopes: form.getAll('scopes').map(String) })
    // Nur Rollen-Grants (befristeter Notfallzugriff darf nicht in ein Token übergehen)
    const beyond = scopesBeyond(d.scopes, ctx.roleGrants)
    if (beyond.length) return { ok: false, error: ctx.t('developer.errors.beyond', { scopes: beyond.join(', ') }) }
    const now = new Date()
    const active = await db.apiToken.count({ where: { orgId: ctx.org.id, createdById: ctx.user.id, personal: true, revokedAt: null, expiresAt: { gt: now } } })
    if (active >= MAX_ACTIVE) return { ok: false, error: 'developer.errors.limit' }
    const token = 'cos_' + randomToken(32)
    const expiresAt = tokenExpiry(d.days, now)
    const row = await db.apiToken.create({ data: { orgId: ctx.org.id, name: d.name, scopes: d.scopes, tokenHash: hashToken(token), createdById: ctx.user.id, personal: true, expiresAt } })
    await audit(ctx, { action: 'admin.api_token.create', entityType: 'ApiToken', entityId: row.id, after: { name: d.name, scopes: d.scopes, prefix: token.slice(0, 8), personal: true, expiresAt: expiresAt.toISOString() } })
    refresh()
    return { ok: true, data: { secret: token }, message: 'developer.tokens.created' }
  })
}

export async function revokePersonalTokenAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const tok = await db.apiToken.findFirst({ where: { id, orgId: ctx.org.id, createdById: ctx.user.id, personal: true, revokedAt: null } })
    if (!tok) return { ok: false, error: 'common.notFound' }
    const at = new Date()
    await db.apiToken.update({ where: { id }, data: { revokedAt: at } })
    await audit(ctx, { action: 'admin.api_token.revoke', entityType: 'ApiToken', entityId: id, before: { name: tok.name, scopes: tok.scopes, revokedAt: null }, after: { revokedAt: at }, context: { personal: true } })
    refresh()
    return { ok: true, message: 'developer.tokens.revoked' }
  })
}
