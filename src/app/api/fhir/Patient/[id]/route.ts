import { type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiAuth, apiError, isErr } from '@/lib/api-auth'
import { fhirJson, patient } from '@/lib/fhir'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const api = await apiAuth(req, 'fhir:read', { fhir: true })
  if (isErr(api)) return api
  const { id } = await params
  const r = await db.resident.findFirst({ where: { id, orgId: api.orgId }, include: { unit: { select: { name: true } }, org: { select: { name: true } } } })
  if (!r) return apiError(404, 'not_found', `Patient/${id} not found`, true)
  return fhirJson(patient(r, r.org.name))
}
