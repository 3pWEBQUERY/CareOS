import { type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiAuth, apiError, isErr } from '@/lib/api-auth'
import { fhirJson, LOINC_KEYS, vitalObservations } from '@/lib/fhir'

/** GET /api/fhir/Observation/{messung}-{parameter} */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const api = await apiAuth(req, 'fhir:read', { fhir: true })
  if (isErr(api)) return api
  const { id } = await params
  const i = id.lastIndexOf('-')
  const key = LOINC_KEYS.find((k) => k === id.slice(i + 1))
  const v = key ? await db.vitalSign.findFirst({ where: { id: id.slice(0, i), resident: { orgId: api.orgId } } }) : null
  const obs = v && key ? vitalObservations(v, [key])[0] : null
  if (!obs) return apiError(404, 'not_found', `Observation/${id} not found`, true)
  return fhirJson(obs)
}
