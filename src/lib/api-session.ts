import 'server-only'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, sessionFromToken } from '@/lib/auth/session'

/** Sitzung aus dem Cookie für Route Handler (Push, Offline-Synchronisation). Nur mit abgeschlossener MFA. */
export async function routeSession(req: NextRequest) {
  return sessionFromToken(req.cookies.get(SESSION_COOKIE)?.value)
}

/** Schutz vor Cross-Site-Anfragen bei schreibenden Route Handlern: Origin muss zum Host passen. */
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site'
  try {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
