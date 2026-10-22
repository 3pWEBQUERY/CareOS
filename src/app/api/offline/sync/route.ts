import type { NextRequest } from 'next/server'
import { getCtx } from '@/lib/context'
import { needsMfaSetup } from '@/lib/auth/mfa-gate'
import { rateLimit } from '@/lib/rate-limit'
import { applyOps } from '@/lib/offline/apply'
import { syncSchema } from '@/lib/offline/validate'
import { json, routeSession, sameOrigin } from '@/lib/api-session'

export const dynamic = 'force-dynamic'

/**
 * Offline-Synchronisation (PRD §39). Sitzung aus dem Cookie, danach gleicher Kontext wie Server Actions
 * (Berechtigungen, Bereich der Person). Antwort pro Vorgang: applied | duplicate | conflict | rejected | error.
 */
export async function POST(req: NextRequest) {
  const s = await routeSession(req)
  if (!s) return json({ error: 'unauthorized' }, 401)
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  if (!(await rateLimit(`offline-sync:${s.userId}`, 30, 60_000)).ok) return json({ error: 'rate' }, 429)
  if (Number(req.headers.get('content-length') ?? 0) > 1_000_000) return json({ error: 'too_large' }, 413)
  const body = syncSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return json({ error: 'invalid' }, 400)
  const ctx = await getCtx()
  if (ctx.user.id !== s.userId) return json({ error: 'unauthorized' }, 401)
  // MFA-Pflicht der Organisation gilt wie bei Server Actions; Einträge bleiben auf dem Gerät vorgemerkt.
  if (await needsMfaSetup(ctx)) return json({ error: 'mfa_setup_required' }, 403)
  const results = await applyOps(ctx, body.data.ops)
  return json({ results })
}
