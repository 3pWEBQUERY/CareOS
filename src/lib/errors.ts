import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { count } from '@/lib/metrics'

/**
 * Fehlererfassung (PRD §38, §66): aus onRequestError (src/instrumentation.ts) und den Hintergrundjobs.
 * 1. Strukturierte Logzeile mit Meldung und Stack (Railway Logs).
 * 2. Zähler je Tag und Fingerabdruck in ErrorEvent – ohne Meldung und Anfragedaten (Admin → Sicherheit → Betrieb).
 * 3. Optional Weiterleitung an ERROR_WEBHOOK_URL (JSON, ohne Anfragedaten), z. B. an ein Incident-Tool.
 */
export type ErrorSource = { route: string; routeType: string; method?: string | null; path?: string | null }

const digestOf = (e: unknown) => (typeof e === 'object' && e && 'digest' in e ? String((e as { digest: unknown }).digest).slice(0, 64) : null)
const nameOf = (e: unknown) => (e instanceof Error ? e.name || 'Error' : typeof e)

/** Erste Stack-Zeile aus dem eigenen Code (ohne Zeilen-/Spaltennummern, stabil über Builds). */
export function fingerprint(e: unknown, src: Pick<ErrorSource, 'route' | 'routeType'>) {
  const stack = e instanceof Error ? e.stack ?? '' : ''
  const frame = stack.split('\n').slice(1).find((l) => !l.includes('node_modules') && !l.includes('node:')) ?? ''
  const where = frame.replace(/:\d+:\d+\)?$/, '').replace(/\(.*[\\/](src|\.next)[\\/]/, '($1/').trim()
  return createHash('sha256').update([nameOf(e), src.routeType, src.route, where].join('|')).digest('hex').slice(0, 24)
}

export async function captureError(e: unknown, src: ErrorSource) {
  const name = nameOf(e)
  const digest = digestOf(e)
  count('careos_server_errors_total', { type: src.routeType })
  log.error('request.error', { error: e, route: src.route, routeType: src.routeType, method: src.method ?? null, digest })
  // Erwartete Abbrüche (redirect(), notFound()) sind keine Fehler.
  if (digest && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(digest)) return
  const now = new Date()
  const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const fp = fingerprint(e, src)
  try {
    await db.errorEvent.upsert({
      where: { day_fingerprint: { day, fingerprint: fp } },
      create: { day, fingerprint: fp, name: name.slice(0, 80), route: src.route.slice(0, 200), routeType: src.routeType.slice(0, 20), method: src.method ?? null, digest },
      update: { count: { increment: 1 }, lastAt: now, digest },
    })
  } catch (x) {
    log.warn('error_event.store_failed', { error: x instanceof Error ? x.message : String(x) })
  }
  const hook = process.env.ERROR_WEBHOOK_URL
  if (hook && /^https:\/\//.test(hook)) {
    await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'careos', at: now.toISOString(), name, digest, fingerprint: fp, route: src.route, routeType: src.routeType, release: process.env.RAILWAY_GIT_COMMIT_SHA ?? null }),
      signal: AbortSignal.timeout(3000),
    }).catch((x) => log.warn('error_webhook.failed', { error: x instanceof Error ? x.message : String(x) }))
  }
}
