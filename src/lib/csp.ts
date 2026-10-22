/**
 * Content-Security-Policy (PRD §37) – reine Logik, genutzt von src/proxy.ts (neue Nonce pro Anfrage).
 *
 * - Skripte nur mit Nonce ('strict-dynamic': von Next.js geladene Chunks erben das Vertrauen). Kein 'unsafe-eval' in Produktion.
 * - <style>-Elemente nur mit Nonce; style-Attribute bleiben erlaubt (React setzt Layoutwerte inline, kein Skriptrisiko).
 * - Bilder/Downloads: eigene Herkunft plus Bucket (Presigned URLs nach /api/files/[id]), data:/blob: für QR-Codes und Vorschauen.
 * - Videos in Schulungen: YouTube (nocookie) und Vimeo als iframe, Videodateien über https.
 * - Service Worker, SSE (/api/events), Web Push (Browserdienst, keine Seitenanfrage) und Fonts (selbst gehostet) laufen über 'self'.
 * - Zusätzliche Herkünfte je Umgebung: CSP_IMG_SRC, CSP_CONNECT_SRC, CSP_FRAME_SRC, CSP_MEDIA_SRC (durch Leerzeichen getrennt).
 */

export type CspEnv = Record<string, string | undefined>

export const VIDEO_FRAMES = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com']
export const REPORT_PATH = '/api/csp-report'

const origin = (u: string) => {
  try {
    const x = new URL(u)
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.origin : null
  } catch {
    return null
  }
}

/** Herkünfte des Buckets für Presigned URLs (Path-Style: Endpoint; sonst zusätzlich <bucket>.<host>). */
export function bucketOrigins(e: CspEnv): string[] {
  const endpoint = (e.ENDPOINT || e.AWS_ENDPOINT_URL || '').trim()
  const bucket = (e.BUCKET || e.AWS_S3_BUCKET_NAME || '').trim()
  const base = endpoint ? origin(endpoint) : null
  if (!base) return []
  const out = [base]
  if ((e.S3_FORCE_PATH_STYLE ?? 'true').trim() === 'false' && bucket && /^[a-z0-9.-]+$/.test(bucket)) {
    const u = new URL(base)
    out.push(`${u.protocol}//${bucket}.${u.host}`)
  }
  return out
}

const extra = (v?: string) =>
  (v ?? '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^(https:\/\/[\w.-]+(:\d+)?|https:|data:|blob:|'self')$/.test(s))

export function buildCsp(nonce: string, e: CspEnv, opts: { dev?: boolean } = {}) {
  const dev = opts.dev ?? e.NODE_ENV === 'development'
  const appUrl = (e.APP_URL || (e.RAILWAY_PUBLIC_DOMAIN ? `https://${e.RAILWAY_PUBLIC_DOMAIN}` : '')).trim()
  const https = appUrl.startsWith('https://')
  const bucket = bucketOrigins(e)
  const uniq = (xs: string[]) => [...new Set(xs)].join(' ')
  const d: Record<string, string> = {
    'default-src': "'self'",
    'script-src': uniq(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]),
    // In der Entwicklung fügt Next.js Styles ohne Nonce ein (Hot Reload); eine Nonce würde 'unsafe-inline' aufheben.
    'style-src': dev ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`,
    'style-src-elem': dev ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`,
    'style-src-attr': "'unsafe-inline'",
    'img-src': uniq(["'self'", 'data:', 'blob:', ...bucket, ...extra(e.CSP_IMG_SRC)]),
    'font-src': "'self' data:",
    'connect-src': uniq(["'self'", ...bucket, ...(dev ? ['ws:', 'wss:'] : []), ...extra(e.CSP_CONNECT_SRC)]),
    'media-src': uniq(["'self'", 'blob:', 'https:', ...bucket, ...extra(e.CSP_MEDIA_SRC)]),
    'frame-src': uniq([...VIDEO_FRAMES, ...bucket, ...extra(e.CSP_FRAME_SRC)]),
    'worker-src': "'self'",
    'manifest-src': "'self'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
    'frame-ancestors': "'none'",
    'report-uri': REPORT_PATH,
    'report-to': 'csp',
  }
  const parts = Object.entries(d).map(([k, v]) => `${k} ${v}`)
  if (https && !dev) parts.push('upgrade-insecure-requests')
  return parts.join('; ')
}

/** Kopfzeile: nur melden statt blockieren (CSP_REPORT_ONLY=true, für eine vorsichtige Einführung). */
export const cspHeaderName = (e: CspEnv) => (e.CSP_REPORT_ONLY === 'true' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy')

/** Zufällige Nonce (128 Bit, Base64) – Web Crypto, damit Proxy und Tests ohne node:crypto auskommen. */
export function makeNonce() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s)
}

/** Strenge Richtlinie für JSON- und Datei-Antworten unter /api (keine Seite, nichts nachladen). */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
