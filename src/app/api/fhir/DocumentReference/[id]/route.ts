import { type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiAuth, apiError, isErr } from '@/lib/api-auth'
import { documentReference, fhirJson } from '@/lib/fhir'

/** GET /api/fhir/DocumentReference/{id} */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const api = await apiAuth(req, 'fhir:read', { fhir: true })
  if (isErr(api)) return api
  const { id } = await params
  const rf = await db.residentFile.findFirst({ where: { id, resident: { orgId: api.orgId }, file: { orgId: api.orgId } }, include: { file: { select: { contentType: true, filename: true, size: true, createdAt: true } } } })
  if (!rf) return apiError(404, 'not_found', `DocumentReference/${id} not found`, true)
  return fhirJson(documentReference(rf))
}
