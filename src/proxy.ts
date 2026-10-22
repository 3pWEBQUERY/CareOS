import { NextResponse, type NextRequest } from 'next/server'
import { REPORT_PATH, buildCsp, cspHeaderName, makeNonce } from '@/lib/csp'

/**
 * Läuft vor jeder Seite (nicht für /api, statische Dateien und Build-Assets):
 * 1. Content-Security-Policy mit neuer Nonce pro Anfrage (PRD §37). Next.js liest die Nonce aus dem
 *    weitergereichten CSP-Header und setzt sie auf seine Skripte; Server-Komponenten lesen sie bei Bedarf aus `x-nonce`.
 * 2. Optimistische Prüfung: ohne Sitzungs-Cookie direkt zum Login (ausser /login und /offline).
 *    Die eigentliche Autorisierung erfolgt serverseitig in jeder Seite und Aktion.
 */
const PUBLIC = /^\/(login|offline)(\/|$)/

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  if (!PUBLIC.test(path) && !req.cookies.has('careos_session')) {
    const url = new URL('/login', req.url)
    if (path !== '/') url.searchParams.set('next', path + req.nextUrl.search)
    return NextResponse.redirect(url)
  }
  const nonce = makeNonce()
  const csp = buildCsp(nonce, process.env)
  const header = cspHeaderName(process.env)
  // Aktueller Pfad für das App-Layout (MFA-Pflicht, PRD §33). Immer überschreiben, nie vom Client übernehmen.
  const fwd = new Headers(req.headers)
  fwd.set('x-careos-path', path)
  fwd.set('x-nonce', nonce)
  fwd.set(header, csp)
  const res = NextResponse.next({ request: { headers: fwd } })
  res.headers.set(header, csp)
  res.headers.set('Reporting-Endpoints', `csp="${REPORT_PATH}"`)
  return res
}

export const config = {
  matcher: ['/((?!api|_next|icons/|screenshots/|icon.svg|manifest.webmanifest|sw.js|offline.html|favicon.ico|robots.txt).*)'],
}
