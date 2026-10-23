import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { count } from '@/lib/metrics'
import { LabPayload, labFlag, numericValue } from '@/lib/integrations/lab'
import { processHl7 } from '@/lib/integrations/hl7v2-run'

/**
 * Integration Layer (PRD §40/§41): ein Adapter je Integrationsart (Integration.kind).
 * - `test`: Konfiguration bzw. Verbindung prüfen (Admin → Integrationen → «Verbindung prüfen»).
 * - `import`: eingehende Daten übernehmen (Labor; weitere Arten folgen mit ihrem Adapter).
 * Jede Ausführung wird in IntegrationRun protokolliert (nur Zählwerte und Kennungen, keine Gesundheitsdaten).
 * «prepared» = Schnittstelle vorbereitet (Konfiguration, Protokoll, Datenmodell), Anbindung an ein Fremdsystem fehlt noch.
 *
 * Neue Anbindung: Adapter hier eintragen, Art in INTEGRATION_KINDS (src/lib/admin-shared.ts) und Texte in admin.integrations.kinds.
 */
export type IntegrationRow = { id: string; orgId: string; kind: string; name: string; config: unknown; active: boolean }
export type AdapterResult = { ok: boolean; records?: number; skipped?: number; message?: string; summary?: Record<string, unknown> }
export type Adapter = {
  status: 'ready' | 'prepared'
  test: (it: IntegrationRow) => Promise<AdapterResult>
  import?: (it: IntegrationRow | null, orgId: string, payload: unknown) => Promise<AdapterResult>
}

const cfg = (it: IntegrationRow) => (it.config && typeof it.config === 'object' && !Array.isArray(it.config) ? (it.config as Record<string, unknown>) : {})
const httpsUrl = (v: unknown) => {
  try {
    const u = new URL(String(v ?? ''))
    return u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/** Leerlauf: prüft nur, ob die Konfiguration vollständig ist (Endpunkt https, Pflichtfelder). */
const prepared = (required: string[] = ['endpoint']): Adapter => ({
  status: 'prepared',
  async test(it) {
    const c = cfg(it)
    const missing = required.filter((k) => (k === 'endpoint' ? !httpsUrl(c[k]) : !c[k]))
    return missing.length ? { ok: false, message: 'config:' + missing.join(',') } : { ok: true, message: 'config_ok' }
  },
})

/** FHIR-Server: CapabilityStatement unter <endpoint>/metadata abrufen (5 s Zeitlimit). */
const fhir: Adapter = {
  status: 'ready',
  async test(it) {
    const u = httpsUrl(cfg(it).endpoint)
    if (!u) return { ok: false, message: 'config:endpoint' }
    try {
      const res = await fetch(new URL(u.pathname.replace(/\/$/, '') + '/metadata', u), { headers: { accept: 'application/fhir+json' }, signal: AbortSignal.timeout(5000) })
      if (!res.ok) return { ok: false, message: 'http_' + res.status }
      const body = (await res.json().catch(() => null)) as { resourceType?: string; fhirVersion?: string } | null
      return body?.resourceType === 'CapabilityStatement' ? { ok: true, message: 'fhir ' + (body.fhirVersion ?? '') } : { ok: false, message: 'no_capability_statement' }
    } catch (e) {
      return { ok: false, message: (e as Error).name === 'TimeoutError' ? 'timeout' : 'unreachable' }
    }
  },
}

/** Labor: Befunde übernehmen (Format src/lib/integrations/lab.ts). */
const lab: Adapter = {
  status: 'prepared',
  test: prepared([]).test,
  async import(it, orgId, payload) {
    const parsed = LabPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, message: 'payload', summary: { issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) } }
    let records = 0
    let skipped = 0
    for (const item of parsed.data) {
      const resident = await db.resident.findFirst({
        where: { orgId, ...(item.residentId ? { id: item.residentId } : { insuranceNo: item.insuranceNo }) },
        select: { id: true },
      })
      if (!resident) { skipped++; continue }
      const data = {
        orgId, residentId: resident.id, integrationId: it?.id ?? null, externalId: item.externalId ?? null, code: item.code ?? null, name: item.name,
        value: String(item.value), numeric: numericValue(item.value), unit: item.unit ?? null, refRange: item.refRange ?? null,
        flag: labFlag(item), collectedAt: new Date(item.collectedAt), note: item.note ?? null,
      }
      if (item.externalId) {
        const existing = await db.labResult.findFirst({ where: { orgId, integrationId: it?.id ?? null, externalId: item.externalId }, select: { id: true } })
        if (existing) { skipped++; continue }
      }
      await db.labResult.create({ data })
      records++
    }
    return { ok: true, records, skipped }
  },
}

/**
 * HL7 v2 ADT-Empfang (A01, A02, A03, A21, A22) über POST /api/v1/hl7 (Scope residents:adt). Eingehend, daher ohne
 * Endpunkt; «Verbindung prüfen» meldet bereit. Payload: { text, actor } (src/lib/integrations/hl7v2-run.ts).
 */
const hl7v2: Adapter = {
  status: 'ready',
  async test() { return { ok: true, message: 'inbound' } },
  async import(it, orgId, payload) {
    const p = payload as { text?: unknown; actor?: Parameters<typeof processHl7>[1] } | null
    if (!p || typeof p.text !== 'string' || !p.actor) return { ok: false, message: 'payload' }
    const r = await processHl7(orgId, p.actor, p.text, it?.id ?? null)
    return { ok: r.ack === 'AA', records: r.ack === 'AA' && !r.duplicate ? 1 : 0, skipped: r.duplicate ? 1 : 0, message: r.code, summary: { controlId: r.controlId, event: r.event, ack: r.ack, code: r.code } }
  },
}

export const ADAPTERS: Record<string, Adapter> = {
  hl7_fhir: fhir,
  hl7v2,
  pharmacy: prepared(['endpoint']),
  lab,
  scheduling: prepared(['endpoint']),
  identity_provider: prepared(['endpoint']),
  drug_interactions: prepared(['provider']),
  speech_to_text: prepared(['provider']),
}

export const adapterFor = (kind: string): Adapter | null => ADAPTERS[kind] ?? null

/** Führt eine Operation aus und protokolliert sie in IntegrationRun. */
export async function runIntegration(
  it: IntegrationRow | null,
  orgId: string,
  operation: 'test' | 'import',
  opts: { trigger?: 'manual' | 'api' | 'schedule'; actorId?: string | null; payload?: unknown; kind?: string } = {},
) {
  const kind = it?.kind ?? opts.kind ?? ''
  const adapter = adapterFor(kind)
  const run = await db.integrationRun.create({ data: { orgId, integrationId: it?.id ?? `kind:${kind}`, operation, trigger: opts.trigger ?? 'manual', actorId: opts.actorId ?? null } })
  let r: AdapterResult
  try {
    if (!adapter) r = { ok: false, message: 'no_adapter' }
    else if (operation === 'test') r = it ? await adapter.test(it) : { ok: false, message: 'no_integration' }
    else if (!adapter.import) r = { ok: false, message: 'no_import' }
    else r = await adapter.import(it, orgId, opts.payload)
  } catch (e) {
    log.error('integration.failed', { error: e, kind, operation })
    r = { ok: false, message: 'error' }
  }
  count('careos_integration_runs_total', { kind, operation, ok: String(r.ok) })
  await db.integrationRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), ok: r.ok, records: r.records ?? 0, error: r.ok ? null : (r.message ?? 'error').slice(0, 500), summary: { message: r.message ?? null, skipped: r.skipped ?? 0, ...(r.summary ?? {}) } as Prisma.InputJsonValue },
  })
  return { ...r, runId: run.id }
}
