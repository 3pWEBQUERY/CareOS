import { type NextRequest, NextResponse } from 'next/server'
import type { Prisma, ResidentStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { apiAuth, apiError, clampInt, isErr } from '@/lib/api-auth'
import { residentJson } from '../serialize'

const STATUSES: ResidentStatus[] = ['active', 'absent', 'discharged', 'deceased']

/** GET /api/v1/residents?unitId=&status=active|absent|discharged|deceased|all&q=&limit=&cursor= */
export async function GET(req: NextRequest) {
  const api = await apiAuth(req, 'residents:read')
  if (isErr(api)) return api
  const sp = req.nextUrl.searchParams
  const limit = clampInt(sp.get('limit'), 100, 1, 500)
  const status = sp.get('status') ?? 'current'
  if (status !== 'all' && status !== 'current' && !STATUSES.includes(status as ResidentStatus)) return apiError(400, 'bad_request', 'Invalid status')
  const q = sp.get('q')?.trim()
  const where: Prisma.ResidentWhereInput = {
    orgId: api.orgId,
    ...(sp.get('unitId') ? { unitId: sp.get('unitId')! } : {}),
    ...(status === 'all' ? {} : status === 'current' ? { status: { in: ['active', 'absent'] } } : { status: status as ResidentStatus }),
    ...(q ? { OR: [{ lastName: { contains: q, mode: 'insensitive' } }, { firstName: { contains: q, mode: 'insensitive' } }] } : {}),
  }
  const cursor = sp.get('cursor')
  const rows = await db.resident.findMany({
    where,
    include: { unit: { select: { id: true, name: true } }, room: { select: { number: true } } },
    orderBy: { id: 'asc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const more = rows.length > limit
  const data = rows.slice(0, limit)
  return NextResponse.json({ data: data.map(residentJson), next: more ? data[data.length - 1].id : null })
}
