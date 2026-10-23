import { type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiAudit, apiAuth, apiError, clampInt, isErr, readJson } from '@/lib/api-auth'
import { allergies, bundle, fhirBase, fhirJson, refId } from '@/lib/fhir'
import { parseFhirAllergy } from '@/lib/fhir-write'
import { emit } from '@/lib/events'
import { normalize } from '@/lib/allergy-check'

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

/**
 * POST /api/fhir/AllergyIntolerance – Allergie übernehmen (PRD §41, z. B. aus dem Austrittsbericht). Scope observations:write
 * (klinische Daten aus Umsystemen). Ergänzt die Allergien der Person, nie Überschreiben; bereits erfasst → 200 mit dem
 * bestehenden Eintrag. Die Allergie wirkt sofort im Allergie-Abgleich beim Verordnen und in der Medikamentenrunde.
 */
export async function POST(req: NextRequest) {
  const api = await apiAuth(req, 'observations:write', { fhir: true })
  if (isErr(api)) return api
  const p = parseFhirAllergy(await readJson(req))
  if ('error' in p) return apiError(422, 'validation_failed', p.error, true)
  const r = await db.resident.findFirst({ where: { id: p.residentId, orgId: api.orgId, status: { in: ['active', 'absent'] } } })
  if (!r) return apiError(404, 'not_found', `Patient/${p.residentId} not found or not current`, true)
  const known = r.allergies.findIndex((a) => normalize(a) === normalize(p.text))
  if (known >= 0) return fhirJson(allergies(r)[known], 200)
  const res = await db.resident.updateMany({ where: { id: r.id, updatedAt: r.updatedAt }, data: { allergies: { push: p.text } } })
  if (res.count !== 1) return apiError(409, 'conflict', 'Patient was changed concurrently, retry', true)
  const after = await db.resident.findUniqueOrThrow({ where: { id: r.id } })
  await apiAudit(api, { action: 'api.fhir.allergy.create', entityType: 'Resident', entityId: r.id, before: { allergies: r.allergies }, after: { allergies: after.allergies }, context: { residentId: r.id } })
  await emit({ orgId: api.orgId, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: api.actorId, payload: { fields: ['allergies'], via: 'fhir' } })
  const created = allergies(after)[after.allergies.length - 1]
  const out = fhirJson(created, 201)
  out.headers.set('location', `${fhirBase(req)}/AllergyIntolerance/${created.id}`)
  return out
}
