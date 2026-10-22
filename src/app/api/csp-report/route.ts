import type { NextRequest } from 'next/server'
import { log } from '@/lib/log'
import { count, routeLabel } from '@/lib/metrics'
import { MemoryLimiter } from '@/lib/rate-limit-core'

/**
 * Empfängt CSP-Verstossberichte (report-uri und Reporting API) und schreibt sie ins strukturierte Log.
 * Gespeichert wird nur Richtlinie, Herkunft der blockierten Ressource und Routenmuster – keine Kennungen, keine Inhalte.
 * Ohne Anmeldung erreichbar (Browser senden ohne Cookies); begrenzt je IP im Prozessspeicher.
 */
const limiter = new MemoryLimiter()

type Report = Record<string, unknown>

const originOf = (u: unknown) => {
  if (typeof u !== 'string' || !u) return null
  if (/^(inline|eval|data|blob|self|wasm-eval|trusted-types-sink)$/.test(u)) return u
  try {
    return new URL(u).origin
  } catch {
    return u.slice(0, 40)
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!limiter.hit('csp:' + ip, 50, 60_000).ok) return new Response(null, { status: 429 })
  const text = (await req.text().catch(() => '')).slice(0, 20_000)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }
  // report-uri: { "csp-report": {...} }; Reporting API: [{ type: "csp-violation", body: {...} }]
  const reports: Report[] = Array.isArray(body)
    ? body.filter((r) => r && typeof r === 'object' && (r as Report).type === 'csp-violation').map((r) => ((r as Report).body ?? {}) as Report)
    : body && typeof body === 'object' && (body as Report)['csp-report'] ? [(body as Report)['csp-report'] as Report] : []
  for (const r of reports.slice(0, 10)) {
    const directive = String(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? '').split(' ')[0].slice(0, 40)
    const doc = r['document-uri'] ?? r.documentURL
    let page = ''
    try {
      page = routeLabel(new URL(String(doc)).pathname)
    } catch {}
    count('careos_csp_violations_total', { directive: directive || 'unknown' })
    log.warn('csp.violation', {
      directive,
      blocked: originOf(r['blocked-uri'] ?? r.blockedURL),
      page,
      disposition: r.disposition ?? null,
      sourceFile: originOf(r['source-file'] ?? r.sourceFile),
      line: r['line-number'] ?? r.lineNumber ?? null,
    })
  }
  return new Response(null, { status: 204 })
}
