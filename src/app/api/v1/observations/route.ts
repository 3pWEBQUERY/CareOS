import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { emit } from '@/lib/events'
import { apiAudit, apiAuth, apiError, isErr, readJson } from '@/lib/api-auth'
import { abnormalKeys, mergeLimits, VITALS, VITAL_KEYS, type VitalKey } from '@/lib/vitals'

const vital = (k: VitalKey) => z.number().min(VITALS[k].min).max(VITALS[k].max).nullish()
const Vitals = z.object(Object.fromEntries(VITAL_KEYS.map((k) => [k, vital(k)])) as Record<VitalKey, ReturnType<typeof vital>>).strict()

const Body = z.object({
  residentId: z.string().min(1),
  category: z.enum(['care', 'observation', 'physician', 'relatives', 'incident', 'handover']).default('observation'),
  text: z.string().trim().max(10000).optional(),
  important: z.boolean().default(false),
  at: z.iso.datetime({ offset: true }).optional(),
  vitals: Vitals.optional(),
  vitalsNote: z.string().trim().max(500).optional(),
}).refine((b) => !!b.text || (b.vitals && Object.values(b.vitals).some((v) => v != null)), { message: 'text or vitals required' })

/**
 * POST /api/v1/observations – Verlaufseintrag (Pflegebericht) und/oder Vitalwerte erfassen,
 * z. B. aus Medizingeräten (PRD §40). Einträge werden nie überschrieben.
 */
export async function POST(req: NextRequest) {
  const api = await apiAuth(req, 'observations:write')
  if (isErr(api)) return api
  const parsed = Body.safeParse(await readJson(req))
  if (!parsed.success) return apiError(422, 'validation_failed', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  const b = parsed.data
  const resident = await db.resident.findFirst({ where: { id: b.residentId, orgId: api.orgId, status: { in: ['active', 'absent'] } } })
  if (!resident) return apiError(404, 'not_found', 'Resident not found or not current')
  const at = b.at ? new Date(b.at) : new Date()
  if (at.getTime() > Date.now() + 5 * 60_000) return apiError(422, 'validation_failed', 'at must not be in the future')

  const out: { observation?: unknown; vitals?: unknown } = {}
  if (b.text) {
    const o = await db.observation.create({
      data: { residentId: resident.id, at, category: b.category, text: b.text, important: b.important, authorId: api.actorId, source: 'system', structured: { via: 'api', tokenId: api.token.id } as Prisma.InputJsonValue },
    })
    await apiAudit(api, { action: 'api.observation.create', entityType: 'Observation', entityId: o.id, after: { residentId: resident.id, category: o.category, important: o.important, at: o.at } })
    await emit({ orgId: api.orgId, type: 'observation.created', unitId: resident.unitId, residentId: resident.id, actorId: api.actorId, payload: { observationId: o.id, via: 'api' } })
    out.observation = { id: o.id, residentId: o.residentId, at: o.at.toISOString(), category: o.category, text: o.text, important: o.important }
  }
  const vv = b.vitals ? Object.fromEntries(Object.entries(b.vitals).filter(([, v]) => v != null)) : {}
  if (Object.keys(vv).length) {
    const intKeys: VitalKey[] = ['sys', 'dia', 'pulse', 'spo2', 'pain', 'respRate']
    const data = Object.fromEntries(Object.entries(vv).map(([k, v]) => [k, intKeys.includes(k as VitalKey) ? Math.round(v as number) : v]))
    const v = await db.vitalSign.create({ data: { residentId: resident.id, at, recordedById: api.actorId, note: b.vitalsNote ?? null, ...data } })
    const limits = mergeLimits(await db.vitalThreshold.findMany({ where: { orgId: api.orgId, OR: [{ residentId: null }, { residentId: resident.id }] } }), resident.id)
    const abnormal = abnormalKeys(v, limits)
    await apiAudit(api, { action: 'api.vitals.create', entityType: 'VitalSign', entityId: v.id, after: { residentId: resident.id, at: v.at, ...data } })
    await emit({ orgId: api.orgId, type: 'vitals.recorded', unitId: resident.unitId, residentId: resident.id, actorId: api.actorId, payload: { vitalId: v.id, via: 'api' } })
    if (abnormal.length) await emit({ orgId: api.orgId, type: 'vitals.abnormal', unitId: resident.unitId, residentId: resident.id, actorId: api.actorId, payload: { vitalId: v.id, keys: abnormal, via: 'api' } })
    out.vitals = { id: v.id, residentId: v.residentId, at: v.at.toISOString(), ...data, abnormal }
  }
  return NextResponse.json({ data: out }, { status: 201 })
}
