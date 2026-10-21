import { type NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { apiAuth, apiError, clampInt, isErr } from '@/lib/api-auth'
import { decodeCursor, encodeCursor } from '../serialize'

/**
 * GET /api/v1/events?since=<cursor>&type=task.completed&limit=
 * Domain Events in zeitlicher Reihenfolge (älteste zuerst). Ohne Cursor: die letzten 24 Stunden.
 * Den zurückgegebenen `next`-Cursor beim nächsten Aufruf als `since` übergeben (Polling-Alternative zu Webhooks).
 */
export async function GET(req: NextRequest) {
  const api = await apiAuth(req, 'events:read')
  if (isErr(api)) return api
  const sp = req.nextUrl.searchParams
  const limit = clampInt(sp.get('limit'), 100, 1, 500)
  const since = sp.get('since')
  const cur = decodeCursor(since)
  if (since && !cur) return apiError(400, 'bad_request', 'Invalid cursor')
  const types = sp.getAll('type').flatMap((x) => x.split(',')).filter(Boolean)
  const where: Prisma.DomainEventWhereInput = {
    orgId: api.orgId,
    ...(types.length ? { type: { in: types } } : {}),
    ...(cur ? { OR: [{ createdAt: { gt: cur.at } }, { createdAt: cur.at, id: { gt: cur.id } }] } : { createdAt: { gte: new Date(Date.now() - 86400_000) } }),
  }
  const rows = await db.domainEvent.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit })
  const last = rows[rows.length - 1]
  return NextResponse.json({
    data: rows.map((e) => ({ id: e.id, type: e.type, unitId: e.unitId, residentId: e.residentId, actorId: e.actorId, payload: e.payload, createdAt: e.createdAt.toISOString() })),
    next: last ? encodeCursor(last.createdAt, last.id) : since,
    hasMore: rows.length === limit,
  })
}
