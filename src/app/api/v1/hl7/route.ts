import { type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiAudit, apiAuth, isErr } from '@/lib/api-auth'
import { runIntegration } from '@/lib/integrations/registry'
import { buildAck, parseHl7 } from '@/lib/integrations/hl7v2'

const MAX_BYTES = 256 * 1024

/**
 * POST /api/v1/hl7 – HL7 v2 ADT empfangen (PRD §41): A01 Eintritt, A02 Verlegung, A03 Austritt, A21 Beurlaubung,
 * A22 Rückkehr. Scope `residents:adt`. Body: eine ER7-Nachricht (Segmente durch CR getrennt), Content-Type
 * `x-application/hl7-v2+er7` oder `text/plain`. Antwort: ACK (MSA-1 AA/AE/AR) als `x-application/hl7-v2+er7`,
 * HTTP 200 auch bei AE/AR (Fehler stehen in der Quittung). Jede Nachricht in IntegrationRun und Audit (ohne Inhalt).
 */
export async function POST(req: NextRequest) {
  const api = await apiAuth(req, 'residents:adt')
  if (isErr(api)) return api
  const text = (await req.text()).slice(0, MAX_BYTES + 1)
  const reply = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'x-application/hl7-v2+er7; charset=utf-8', 'cache-control': 'no-store' } })
  let msg = null
  try { msg = parseHl7(text) } catch { msg = null }
  if (text.length > MAX_BYTES) return reply(buildAck(msg, 'AR', 'message too large'))
  const it = await db.integration.findFirst({ where: { orgId: api.orgId, kind: 'hl7v2', active: true }, orderBy: { createdAt: 'asc' } })
  const actor = { orgId: api.orgId, actorId: api.actorId, audit: (e: Parameters<typeof apiAudit>[1]) => apiAudit(api, e), via: 'hl7' as const }
  const r = await runIntegration(it, api.orgId, 'import', { trigger: 'api', actorId: api.actorId, payload: { text, actor }, kind: 'hl7v2' })
  const summary = (r.summary ?? {}) as { ack?: 'AA' | 'AE' | 'AR'; code?: string; event?: string | null; controlId?: string }
  const ack = summary.ack ?? (r.ok ? 'AA' : 'AE')
  await apiAudit(api, { action: 'api.hl7.adt', entityType: 'IntegrationRun', entityId: r.runId, after: { ack, code: summary.code ?? r.message ?? null, event: summary.event ?? null } })
  return reply(buildAck(msg, ack, summary.code ?? r.message ?? ''))
}
