import { type NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { apiAudit, apiAuth, apiError, clampInt, isErr, readJson } from '@/lib/api-auth'
import { emit } from '@/lib/events'
import { parseFhirVital } from '@/lib/fhir-write'
import { abnormalKeys, mergeLimits } from '@/lib/vitals'
import { bundle, fhirBase, fhirJson, keyForLoinc, LOINC_KEYS, refId, vitalObservations } from '@/lib/fhir'

/** date=ge2026-10-01 → Prisma-Filter. Unterstützt eq, ge, gt, le, lt. */
function dateFilter(values: string[]): Prisma.DateTimeFilter | null {
  const f: Prisma.DateTimeFilter = {}
  for (const v of values) {
    const m = /^(eq|ge|gt|le|lt)?(\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?)$/.exec(v)
    if (!m) return null
    const d = new Date(m[2].length === 10 ? m[2] + 'T00:00:00' : m[2])
    if (Number.isNaN(d.getTime())) return null
    const op = m[1] ?? 'eq'
    if (op === 'eq' && m[2].length === 10) { f.gte = d; f.lt = new Date(d.getTime() + 86400_000) }
    else if (op === 'eq') f.equals = d
    else f[op === 'ge' ? 'gte' : op === 'gt' ? 'gt' : op === 'le' ? 'lte' : 'lt'] = d
  }
  return f
}

/** GET /api/fhir/Observation?patient=&code=&category=vital-signs&date=&_count= – Vitalparameter mit LOINC-Codes. */
export async function GET(req: NextRequest) {
  const api = await apiAuth(req, 'fhir:read', { fhir: true })
  if (isErr(api)) return api
  const sp = req.nextUrl.searchParams
  const count = clampInt(sp.get('_count'), 100, 1, 500)
  const category = sp.get('category')
  if (category && !category.endsWith('vital-signs')) return fhirJson(bundle(req, [], 0))
  const codes = (sp.get('code') ?? '').split(',').map((c) => c.replace(/^http:\/\/loinc\.org\|/, '').trim()).filter(Boolean)
  const keys = codes.length ? codes.map(keyForLoinc).filter((k): k is (typeof LOINC_KEYS)[number] => !!k) : LOINC_KEYS
  if (codes.length && !keys.length) return fhirJson(bundle(req, [], 0))
  const pid = refId(sp.get('patient') ?? sp.get('subject'))
  const dates = sp.getAll('date')
  const at = dates.length ? dateFilter(dates) : null
  if (dates.length && !at) return apiError(400, 'bad_request', 'Invalid date parameter', true)
  const where: Prisma.VitalSignWhereInput = {
    resident: { orgId: api.orgId },
    ...(pid ? { residentId: pid } : {}),
    ...(at ? { at } : {}),
    OR: keys.map((k) => ({ [k]: { not: null } })),
  }
  const rows = await db.vitalSign.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'asc' }], take: count })
  const resources = rows.flatMap((v) => vitalObservations(v, keys)).slice(0, count)
  return fhirJson(bundle(req, resources, resources.length))
}

/**
 * POST /api/fhir/Observation – Vitalparameter schreibend (PRD §41), z. B. von Messgeräten oder dem Spital.
 * Scope observations:write. Einzelwert mit LOINC-Code oder Blutdruck-Panel 85354-9; Plausibilität wie in der App.
 * Neue Messung, nie Überschreiben; Abweichungen lösen dieselben Hinweise aus wie eine Erfassung in der App.
 */
export async function POST(req: NextRequest) {
  const api = await apiAuth(req, 'observations:write', { fhir: true })
  if (isErr(api)) return api
  const p = parseFhirVital(await readJson(req))
  if ('error' in p) return apiError(422, 'validation_failed', p.error, true)
  const resident = await db.resident.findFirst({ where: { id: p.residentId, orgId: api.orgId, status: { in: ['active', 'absent'] } } })
  if (!resident) return apiError(404, 'not_found', `Patient/${p.residentId} not found or not current`, true)
  const v = await db.vitalSign.create({ data: { residentId: resident.id, at: p.at, recordedById: api.actorId, note: p.note, ...p.values } })
  const limits = mergeLimits(await db.vitalThreshold.findMany({ where: { orgId: api.orgId, OR: [{ residentId: null }, { residentId: resident.id }] } }), resident.id)
  const abnormal = abnormalKeys(v, limits)
  await apiAudit(api, { action: 'api.fhir.observation.create', entityType: 'VitalSign', entityId: v.id, after: { residentId: resident.id, at: v.at, ...p.values }, context: { residentId: resident.id, abnormal } })
  await emit({ orgId: api.orgId, type: 'vitals.recorded', unitId: resident.unitId, residentId: resident.id, actorId: api.actorId, payload: { vitalId: v.id, via: 'fhir' } })
  if (abnormal.length) await emit({ orgId: api.orgId, type: 'vitals.abnormal', unitId: resident.unitId, residentId: resident.id, actorId: api.actorId, payload: { vitalId: v.id, keys: abnormal, via: 'fhir' } })
  const resources = vitalObservations(v)
  const res = fhirJson(resources.length === 1 ? resources[0] : bundle(req, resources, resources.length), 201)
  res.headers.set('location', `${fhirBase(req)}/Observation/${resources[0].id}`)
  return res
}
