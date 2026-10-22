import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiAudit, apiAuth, apiError, isErr, readJson } from '@/lib/api-auth'
import { LabPayload } from '@/lib/integrations/lab'
import { runIntegration } from '@/lib/integrations/registry'

/**
 * POST /api/v1/labs – Laborbefunde übermitteln (PRD §40, Schnittstelle vorbereitet). Scope `labs:write`.
 * Body: `{ "results": [ { residentId | insuranceNo, externalId?, code?, name, value, unit?, refRange?, flag?, collectedAt } ] }`.
 * Zuordnung zur aktiven Labor-Integration der Organisation (falls vorhanden); doppelte externalId werden übersprungen.
 * Jeder Aufruf wird in IntegrationRun und im Audit-Protokoll festgehalten.
 */
export async function POST(req: NextRequest) {
  const api = await apiAuth(req, 'labs:write')
  if (isErr(api)) return api
  const body = (await readJson(req)) as { results?: unknown } | null
  const parsed = LabPayload.safeParse(body?.results)
  if (!parsed.success) return apiError(422, 'validation_failed', parsed.error.issues.slice(0, 10).map((i) => `results.${i.path.join('.')}: ${i.message}`).join('; '))
  const it = await db.integration.findFirst({ where: { orgId: api.orgId, kind: 'lab', active: true }, orderBy: { createdAt: 'asc' } })
  const r = await runIntegration(it, api.orgId, 'import', { trigger: 'api', actorId: api.actorId, payload: parsed.data, kind: 'lab' })
  await apiAudit(api, { action: 'api.labs.import', entityType: 'IntegrationRun', entityId: r.runId, after: { ok: r.ok, records: r.records ?? 0, skipped: r.skipped ?? 0 } })
  if (!r.ok) return apiError(422, 'validation_failed', r.message ?? 'import failed')
  return NextResponse.json({ data: { imported: r.records ?? 0, skipped: r.skipped ?? 0, runId: r.runId } }, { status: 201 })
}
