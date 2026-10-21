import { type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiAuth, clampInt, isErr } from '@/lib/api-auth'
import { bundle, fhirJson, medicationStatement, refId } from '@/lib/fhir'

/** GET /api/fhir/MedicationStatement?patient=&status=active|stopped|completed&_count= */
export async function GET(req: NextRequest) {
  const api = await apiAuth(req, 'fhir:read', { fhir: true })
  if (isErr(api)) return api
  const sp = req.nextUrl.searchParams
  const count = clampInt(sp.get('_count'), 100, 1, 500)
  const pid = refId(sp.get('patient') ?? sp.get('subject'))
  const rows = await db.medication.findMany({ where: { resident: { orgId: api.orgId }, ...(pid ? { residentId: pid } : {}) }, orderBy: [{ startDate: 'desc' }, { id: 'asc' }], take: 2000 })
  const status = sp.get('status')
  const resources = rows.map(medicationStatement).filter((m) => !status || status.split(',').includes(m.status))
  return fhirJson(bundle(req, resources.slice(0, count), resources.length))
}
