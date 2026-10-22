import type { NextRequest } from 'next/server'
import { env, pushConfigured } from '@/lib/env'
import { json, routeSession } from '@/lib/api-session'

export const dynamic = 'force-dynamic'

/** Öffentlicher VAPID-Schlüssel für pushManager.subscribe({ applicationServerKey }). */
export async function GET(req: NextRequest) {
  if (!(await routeSession(req))) return json({ error: 'unauthorized' }, 401)
  if (!pushConfigured()) return json({ configured: false }, 404)
  return json({ configured: true, key: env.push.publicKey })
}
