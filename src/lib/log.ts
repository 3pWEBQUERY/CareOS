/**
 * Strukturiertes Logging (PRD §66 Observability).
 * Produktion: eine JSON-Zeile pro Ereignis auf stdout/stderr (Railway Logs filtern nach `level`, `msg`, Feldern).
 * Entwicklung: lesbare Zeile. Mindeststufe über LOG_LEVEL (debug | info | warn | error, Standard info).
 *
 * Datenschutz: Logs enthalten nie Gesundheitsdaten, Passwörter, Tokens oder E-Mail-Adressen.
 * Felder mit sensiblen Namen werden maskiert; Fehler werden auf Name, Meldung und Stack reduziert.
 * Ohne Server-Abhängigkeiten: nutzbar in Proxy, Instrumentation, Jobs und Tests.
 */
import { count } from '@/lib/metrics'

export type Level = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|email|mfa|otp|p256dh|auth$|key$/i

const minLevel = (): Level => {
  const l = (process.env.LOG_LEVEL ?? '').toLowerCase()
  return l in ORDER ? (l as Level) : 'info'
}
const asJson = () => process.env.LOG_FORMAT === 'json' || (process.env.LOG_FORMAT !== 'pretty' && process.env.NODE_ENV === 'production')

/** Fehler und verschachtelte Objekte serialisierbar und ohne Geheimnisse machen. */
export function sanitize(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return v.length > 2000 ? v.slice(0, 2000) + '…' : v
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Date) return v.toISOString()
  if (v instanceof Error) {
    const digest = (v as Error & { digest?: string }).digest
    return { name: v.name, message: v.message.slice(0, 1000), ...(digest ? { digest } : {}), stack: v.stack?.split('\n').slice(0, 12).join('\n') }
  }
  if (depth > 4) return '[…]'
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => sanitize(x, depth + 1))
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? '[redacted]' : sanitize(x, depth + 1)
    return out
  }
  return String(v)
}

export function formatLine(level: Level, msg: string, fields: Record<string, unknown> = {}, json = asJson(), now = new Date()) {
  const clean = sanitize(fields) as Record<string, unknown>
  if (json) return JSON.stringify({ time: now.toISOString(), level, msg, ...clean })
  const rest = Object.keys(clean).length ? ' ' + JSON.stringify(clean) : ''
  return `[${level}] ${msg}${rest}`
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (level === 'error') count('careos_log_errors_total')
  if (level === 'warn') count('careos_log_warnings_total')
  if (ORDER[level] < ORDER[minLevel()]) return
  const line = formatLine(level, msg, fields)
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
}
