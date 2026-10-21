import { type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiAuth, clampInt, isErr } from '@/lib/api-auth'
import { allergies, bundle, fhirJson, refId } from '@/lib/fhir'

/** GET /api/fhir/AllergyIntolerance?patient=&_count= */
export async function GET(req: NextRequest) {
  const api = await apiAuth(req, 'fhir:read', { fhir: true })
  if (isErr(api)) return api
  const sp = req.nextUrl.searchParams
  const count = clampInt(sp.get('_count'), 100, 1, 500)
  const pid = refId(sp.get('patient'))
  const rows = await db.resident.findMany({ where: { orgId: api.orgId, ...(pid ? { id: pid } : {}), NOT: { allergies: { isEmpty: true } } }, orderBy: { id: 'asc' } })
  const resources = rows.flatMap(allergies)
  return fhirJson(bundle(req, resources.slice(0, count), resources.length))
}
