import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, sessionFromToken } from '@/lib/auth/session'
import { subscribe } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

/** Server-Sent Events: verteilt Domain Events an verbundene Clients der eigenen Organisation. */
export async function GET(req: NextRequest) {
  const session = await sessionFromToken(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return new Response('unauthorized', { status: 401 })
  const orgId = session.user.orgId
  const userId = session.userId
  const assignments = await db.roleAssignment.findMany({ where: { userId }, select: { unitId: true, locationId: true } })
  const orgWide = assignments.some((a) => !a.unitId && !a.locationId)
  const units = orgWide ? null : new Set((await db.unit.findMany({ where: { orgId, OR: [{ id: { in: assignments.map((a) => a.unitId!).filter(Boolean) } }, { locationId: { in: assignments.map((a) => a.locationId!).filter(Boolean) } }] }, select: { id: true } })).map((u) => u.id))

  const enc = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let ping: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (s: string) => {
        try {
          ctrl.enqueue(enc.encode(s))
        } catch {
          cleanup()
        }
      }
      send('retry: 5000\n\n')
      unsubscribe = await subscribe((e) => {
        if (e.orgId !== orgId) return
        if (e.userIds && !e.userIds.includes(userId)) return
        if (!e.userIds && units && e.unitId && !units.has(e.unitId)) return
        send(`data: ${JSON.stringify({ type: e.type, unitId: e.unitId, residentId: e.residentId, actorId: e.actorId, payload: e.userIds ? e.payload : undefined })}\n\n`)
      })
      ping = setInterval(() => send(': ping\n\n'), 25_000)
    },
    cancel() {
      cleanup()
    },
  })
  function cleanup() {
    unsubscribe?.()
    unsubscribe = null
    if (ping) clearInterval(ping)
  }
  req.signal.addEventListener('abort', cleanup)
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  })
}
