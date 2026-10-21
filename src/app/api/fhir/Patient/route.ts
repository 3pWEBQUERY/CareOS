import { type NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { apiAuth, apiError, clampInt, isErr } from '@/lib/api-auth'
import { bundle, fhirJson, patient, SYS } from '@/lib/fhir'
import { dbDate, parseDateKey } from '@/lib/time'

/** GET /api/fhir/Patient?name=&family=&given=&birthdate=&gender=&identifier=&active=&_id=&_count= */
export async function GET(req: NextRequest) {
  const api = await apiAuth(req, 'fhir:read', { fhir: true })
  if (isErr(api)) return api
  const sp = req.nextUrl.searchParams
  const count = clampInt(sp.get('_count'), 50, 1, 200)
  const and: Prisma.ResidentWhereInput[] = [{ orgId: api.orgId }]
  const name = sp.get('name')
  if (name) and.push({ OR: [{ lastName: { contains: name, mode: 'insensitive' } }, { firstName: { contains: name, mode: 'insensitive' } }] })
  if (sp.get('family')) and.push({ lastName: { startsWith: sp.get('family')!, mode: 'insensitive' } })
  if (sp.get('given')) and.push({ firstName: { startsWith: sp.get('given')!, mode: 'insensitive' } })
  if (sp.get('_id')) and.push({ id: { in: sp.get('_id')!.split(',') } })
  const bd = sp.get('birthdate')
  if (bd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) return apiError(400, 'bad_request', 'birthdate must be YYYY-MM-DD', true)
    and.push({ birthDate: dbDate(parseDateKey(bd)) })
  }
  const g = sp.get('gender')
  if (g) and.push({ sex: g === 'female' ? { in: ['f', 'w'] } : g === 'male' ? 'm' : { notIn: ['f', 'w', 'm'] } })
  const ident = sp.get('identifier')
  if (ident) {
    const [system, value] = ident.includes('|') ? ident.split('|') : ['', ident]
    if (system === SYS.insurance) and.push({ insuranceNo: value })
    else if (system === SYS.resident) and.push({ id: value })
    else and.push({ OR: [{ id: value }, { insuranceNo: value }] })
  }
  const active = sp.get('active')
  if (active === 'true') and.push({ status: { in: ['active', 'absent'] } })
  if (active === 'false') and.push({ status: { in: ['discharged', 'deceased'] } })
  const where = { AND: and }
  const [rows, total, org] = await Promise.all([
    db.resident.findMany({ where, include: { unit: { select: { name: true } } }, orderBy: [{ lastName: 'asc' }, { id: 'asc' }], take: count }),
    db.resident.count({ where }),
    db.organization.findUniqueOrThrow({ where: { id: api.orgId }, select: { name: true } }),
  ])
  return fhirJson(bundle(req, rows.map((r) => patient(r, org.name)), total))
}
