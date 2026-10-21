import { type NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { apiAuth, apiError, clampInt, isErr } from '@/lib/api-auth'
import { bundle, fhirJson, keyForLoinc, LOINC_KEYS, refId, vitalObservations } from '@/lib/fhir'

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
