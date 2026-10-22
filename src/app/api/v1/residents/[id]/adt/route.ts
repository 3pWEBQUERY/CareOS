import { type NextRequest, NextResponse } from 'next/server'
import { apiAudit, apiAuth, apiError, isErr, readJson } from '@/lib/api-auth'
import { AdtError, adtEvent, EventBody } from '@/lib/adt'
import { residentJson } from '../../../serialize'

/**
 * POST /api/v1/residents/{id}/adt – Verlegung, Abwesenheit, Rückkehr, Austritt (PRD §41, Scope residents:adt).
 * Body: { "event": "transfer", "unitId", "roomId"? } | { "event": "leave", "reason" } | { "event": "return", "roomId"? }
 *     | { "event": "discharge", "deceased"?, "reason"? }; optional "at" (ISO 8601 mit Zeitzone).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const api = await apiAuth(req, 'residents:adt')
  if (isErr(api)) return api
  const parsed = EventBody.safeParse(await readJson(req))
  if (!parsed.success) return apiError(422, 'validation_failed', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  try {
    const r = await adtEvent({ orgId: api.orgId, actorId: api.actorId, audit: (e) => apiAudit(api, e) }, (await params).id, parsed.data)
    return NextResponse.json({ data: residentJson(r) })
  } catch (e) {
    if (e instanceof AdtError) return apiError(e.status, e.code, e.message)
    throw e
  }
}
