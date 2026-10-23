'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { randomToken } from '@/lib/crypto'
import { hashToken } from '@/lib/auth/session'
import { signPayload } from '@/lib/events'
import { API_SCOPES, EVENT_TYPES, INTEGRATION_KINDS } from '@/lib/admin-shared'
import { maskConfig, unmask } from './mask'
import { TOKEN_DAYS, tokenExpiry } from '@/lib/api-tokens'

async function admin() {
  const ctx = await getCtx()
  assertCan(ctx, 'admin.integrations')
  return ctx
}

// ───────── API-Tokens ─────────

export async function createTokenAction(form: FormData): Promise<ActionResult<{ secret: string }>> {
  return run(async () => {
    const ctx = await admin()
    const name = fd(form, 'name').slice(0, 80)
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    const scopes = API_SCOPES.filter((s) => form.getAll('scopes').includes(s))
    if (!scopes.length) return { ok: false, error: 'admin.api.pickScope' }
    // Optional befristet (Developer-Portal: persönliche Tokens immer befristet)
    const days = Number(fd(form, 'days') || 0)
    const expiresAt = days > 0 && (TOKEN_DAYS as readonly number[]).includes(days) ? tokenExpiry(days) : null
    const token = 'cos_' + randomToken(32)
    const row = await db.apiToken.create({ data: { orgId: ctx.org.id, name, scopes, tokenHash: hashToken(token), createdById: ctx.user.id, expiresAt } })
    await audit(ctx, { action: 'admin.api_token.create', entityType: 'ApiToken', entityId: row.id, after: { name, scopes, prefix: token.slice(0, 8), expiresAt: expiresAt?.toISOString() ?? null } })
    refresh()
    return { ok: true, data: { secret: token }, message: 'admin.api.tokenCreated' }
  })
}

export async function revokeTokenAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const tok = await db.apiToken.findFirst({ where: { id, orgId: ctx.org.id, revokedAt: null } })
    if (!tok) return { ok: false, error: 'common.notFound' }
    await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } })
    await audit(ctx, { action: 'admin.api_token.revoke', entityType: 'ApiToken', entityId: id, before: { name: tok.name, scopes: tok.scopes, revokedAt: null }, after: { revokedAt: new Date() } })
    refresh()
    return { ok: true, message: 'admin.api.tokenRevoked' }
  })
}

// ───────── Webhooks ─────────

function validUrl(raw: string) {
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:') return u.toString()
    if (u.protocol === 'http:' && !env.isProd) return u.toString()
    return null
  } catch {
    return null
  }
}
const pickEvents = (form: FormData) => {
  const v = form.getAll('events').map(String)
  return v.includes('*') ? ['*'] : EVENT_TYPES.filter((e) => v.includes(e))
}

export async function createWebhookAction(form: FormData): Promise<ActionResult<{ secret: string }>> {
  return run(async () => {
    const ctx = await admin()
    const url = validUrl(fd(form, 'url'))
    if (!url) return { ok: false, error: 'admin.webhooks.badUrl', field: 'url' }
    const events = pickEvents(form)
    if (!events.length) return { ok: false, error: 'admin.webhooks.pickEvent' }
    const secret = 'whsec_' + randomToken(24)
    const hook = await db.webhook.create({ data: { orgId: ctx.org.id, url, events, secret, active: true } })
    await audit(ctx, { action: 'admin.webhook.create', entityType: 'Webhook', entityId: hook.id, after: { url, events, active: true } })
    refresh()
    return { ok: true, data: { secret }, message: 'admin.webhooks.created' }
  })
}

export async function updateWebhookAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const before = await db.webhook.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!before) return { ok: false, error: 'common.notFound' }
    const url = validUrl(fd(form, 'url'))
    if (!url) return { ok: false, error: 'admin.webhooks.badUrl', field: 'url' }
    const events = pickEvents(form)
    if (!events.length) return { ok: false, error: 'admin.webhooks.pickEvent' }
    const active = fdBool(form, 'active')
    await db.webhook.update({ where: { id }, data: { url, events, active } })
    await audit(ctx, { action: 'admin.webhook.update', entityType: 'Webhook', entityId: id, before: { url: before.url, events: before.events, active: before.active }, after: { url, events, active } })
    refresh()
  })
}

export async function rotateWebhookSecretAction(form: FormData): Promise<ActionResult<{ secret: string }>> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const hook = await db.webhook.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!hook) return { ok: false, error: 'common.notFound' }
    const secret = 'whsec_' + randomToken(24)
    await db.webhook.update({ where: { id }, data: { secret } })
    await audit(ctx, { action: 'admin.webhook.rotate_secret', entityType: 'Webhook', entityId: id })
    refresh()
    return { ok: true, data: { secret }, message: 'admin.webhooks.rotated' }
  })
}

export async function deleteWebhookAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const hook = await db.webhook.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!hook) return { ok: false, error: 'common.notFound' }
    await db.webhook.delete({ where: { id } })
    await audit(ctx, { action: 'admin.webhook.delete', entityType: 'Webhook', entityId: id, before: { url: hook.url, events: hook.events, active: hook.active } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}

/** Sendet ein signiertes Test-Ereignis und protokolliert die Zustellung. */
export async function testWebhookAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const hook = await db.webhook.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!hook) return { ok: false, error: 'common.notFound' }
    const eventId = 'test_' + randomToken(9)
    const raw = JSON.stringify({ event: 'webhook.test', data: { id: eventId, orgId: ctx.org.id, type: 'webhook.test', createdAt: new Date().toISOString(), payload: { message: 'CareOS test delivery' } } })
    let status: number | null = null
    let error: string | null = null
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-careos-event': 'webhook.test', 'x-careos-signature': 'sha256=' + signPayload(hook.secret, raw) },
        body: raw,
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      })
      status = res.status
    } catch (e) {
      error = String(e).slice(0, 300)
    }
    await db.webhookDelivery.create({ data: { webhookId: hook.id, eventId, status, error, attempts: 1 } })
    await audit(ctx, { action: 'admin.webhook.test', entityType: 'Webhook', entityId: id, context: { status, error } })
    refresh()
    if (status && status >= 200 && status < 300) return { ok: true, message: ctx.t('admin.webhooks.testOk', { status }) }
    return { ok: false, error: ctx.t('admin.webhooks.testFailed', { status: status ?? error ?? '–' }) }
  })
}

// ───────── Integrationen ─────────

export async function saveIntegrationAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const kind = fd(form, 'kind')
    if (!(INTEGRATION_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'admin.integrations.pickKind', field: 'kind' }
    const name = fd(form, 'name').slice(0, 80)
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    let config: Record<string, unknown>
    try {
      const v = JSON.parse(fd(form, 'config') || '{}')
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
      config = v
    } catch {
      return { ok: false, error: 'admin.integrations.badJson', field: 'config' }
    }
    const active = fdBool(form, 'active')
    if (id) {
      const before = await db.integration.findFirst({ where: { id, orgId: ctx.org.id } })
      if (!before) return { ok: false, error: 'common.notFound' }
      // Maskierte Geheimnisse ("********") behalten ihren bisherigen Wert.
      const old = (before.config ?? {}) as Record<string, unknown>
      config = unmask(config, old)
      await db.integration.update({ where: { id }, data: { kind, name, active, config: config as Prisma.InputJsonValue } })
      await audit(ctx, { action: 'admin.integration.update', entityType: 'Integration', entityId: id, before: { kind: before.kind, name: before.name, active: before.active, config: maskConfig(old) }, after: { kind, name, active, config: maskConfig(config) } })
    } else {
      const it = await db.integration.create({ data: { orgId: ctx.org.id, kind, name, active, config: config as Prisma.InputJsonValue } })
      await audit(ctx, { action: 'admin.integration.create', entityType: 'Integration', entityId: it.id, after: { kind, name, active, config: maskConfig(config) } })
    }
    refresh()
  })
}

export async function deleteIntegrationAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const it = await db.integration.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!it) return { ok: false, error: 'common.notFound' }
    await db.integration.delete({ where: { id } })
    await audit(ctx, { action: 'admin.integration.delete', entityType: 'Integration', entityId: id, before: { kind: it.kind, name: it.name, config: maskConfig((it.config ?? {}) as Record<string, unknown>) } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}

// ───────── Integration Layer: Prüfung und Import (src/lib/integrations/registry.ts) ─────────

export async function testIntegrationAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const it = await db.integration.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!it) return { ok: false, error: 'common.notFound' }
    const { runIntegration } = await import('@/lib/integrations/registry')
    const r = await runIntegration(it, ctx.org.id, 'test', { actorId: ctx.user.id })
    await audit(ctx, { action: 'admin.integration.test', entityType: 'Integration', entityId: id, after: { ok: r.ok, message: r.message ?? null, runId: r.runId } })
    refresh()
    return r.ok ? { ok: true, message: ctx.t('platform.integrations.testOk') } : { ok: false, error: ctx.t('platform.integrations.testFailed', { error: r.message ?? '–' }) }
  })
}

export async function importIntegrationAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const it = await db.integration.findFirst({ where: { id: fd(form, 'id'), orgId: ctx.org.id } })
    if (!it) return { ok: false, error: 'common.notFound' }
    if (!it.active) return { ok: false, error: 'platform.integrations.errors.inactive' }
    const { adapterFor, runIntegration } = await import('@/lib/integrations/registry')
    if (!adapterFor(it.kind)?.import) return { ok: false, error: 'platform.integrations.errors.kind' }
    let payload: unknown
    try {
      payload = JSON.parse(fd(form, 'payload'))
    } catch {
      return { ok: false, error: 'platform.integrations.errors.payload', field: 'payload' }
    }
    const r = await runIntegration(it, ctx.org.id, 'import', { actorId: ctx.user.id, payload })
    await audit(ctx, { action: 'admin.integration.import', entityType: 'Integration', entityId: it.id, after: { ok: r.ok, records: r.records ?? 0, skipped: r.skipped ?? 0, runId: r.runId } })
    refresh()
    if (!r.ok) return { ok: false, error: 'platform.integrations.errors.payload', field: 'payload' }
    return { ok: true, message: ctx.t('platform.integrations.imported', { n: r.records ?? 0, skipped: r.skipped ?? 0 }) }
  })
}
