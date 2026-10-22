import type { NextRequest } from 'next/server'
import { dictionary } from '@/i18n'
import { makeT, type Locale } from '@/i18n/core'
import { pushConfigured } from '@/lib/env'
import { sendTestPush } from '@/lib/push'
import { rateLimit } from '@/lib/rate-limit'
import { json, routeSession, sameOrigin } from '@/lib/api-session'

export const dynamic = 'force-dynamic'

/** Testnachricht an alle Geräte der angemeldeten Person. */
export async function POST(req: NextRequest) {
  const s = await routeSession(req)
  if (!s) return json({ error: 'unauthorized' }, 401)
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  if (!pushConfigured()) return json({ error: 'not_configured' }, 404)
  if (!(await rateLimit(`push-test:${s.userId}`, 5, 60_000)).ok) return json({ error: 'rate' }, 429)
  const locale = s.user.locale as Locale
  const t = makeT(dictionary(locale), locale, 'resident')
  const r = await sendTestPush(s.userId, t)
  return json({ ok: true, ...r })
}
