import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { auditSystem } from '@/lib/audit'
import { pushConfigured } from '@/lib/env'
import { parseUserAgent } from '@/lib/admin-shared'
import { json, routeSession, sameOrigin } from '@/lib/api-session'

export const dynamic = 'force-dynamic'

const subSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'https'),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
})

/** Gerät für Web Push registrieren (PRD §25). Ein Endpoint gehört immer nur der zuletzt angemeldeten Person. */
export async function POST(req: NextRequest) {
  const s = await routeSession(req)
  if (!s) return json({ error: 'unauthorized' }, 401)
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  if (!pushConfigured()) return json({ error: 'not_configured' }, 404)
  const parsed = subSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'invalid' }, 400)
  const { endpoint, keys } = parsed.data
  const ua = req.headers.get('user-agent')
  const p = parseUserAgent(ua)
  const label = [p.browser, p.os].filter(Boolean).join(' · ').slice(0, 120) || null
  const sub = await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: s.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: label },
    update: { userId: s.userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: label },
  })
  await auditSystem({ action: 'push.subscribe', entityType: 'PushSubscription', entityId: sub.id, orgId: s.user.orgId, userId: s.userId, after: { device: label }, ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null, userAgent: ua?.slice(0, 400) ?? null })
  const devices = await db.pushSubscription.count({ where: { userId: s.userId } })
  return json({ ok: true, devices })
}

/** Gerät abmelden (Profil oder Abmeldung). */
export async function DELETE(req: NextRequest) {
  const s = await routeSession(req)
  if (!s) return json({ error: 'unauthorized' }, 401)
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
  const { count } = await db.pushSubscription.deleteMany({ where: { userId: s.userId, endpoint } })
  if (count) await auditSystem({ action: 'push.unsubscribe', entityType: 'PushSubscription', orgId: s.user.orgId, userId: s.userId, ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null, userAgent: req.headers.get('user-agent')?.slice(0, 400) ?? null })
  const devices = await db.pushSubscription.count({ where: { userId: s.userId } })
  return json({ ok: true, removed: count, devices })
}
