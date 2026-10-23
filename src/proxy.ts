import { NextResponse, type NextRequest } from 'next/server'
import { REPORT_PATH, buildCsp, cspHeaderName, makeNonce } from '@/lib/csp'
import { gate } from '@/lib/portal/routing'

/**
 * Läuft vor jeder Seite (nicht für /api, statische Dateien und Build-Assets):
 * 1. Content-Security-Policy mit neuer Nonce pro Anfrage (PRD §37). Next.js liest die Nonce aus dem
 *    weitergereichten CSP-Header und setzt sie auf seine Skripte; Server-Komponenten lesen sie bei Bedarf aus `x-nonce`.
 * 2. Optimistische Prüfung: ohne Sitzungs-Cookie direkt zum Login (ausser /login, /register und /offline).
 *    Angehörigenportal (/portal): eigenes Cookie, öffentlich nur /portal/login und /portal/invite.
 *    Das Cookie der jeweils anderen Seite zählt nie (src/lib/portal/routing.ts).
 *    Die eigentliche Autorisierung erfolgt serverseitig in jeder Seite und Aktion.
 */
export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  const g = gate(path, req.cookies)
  if (g.kind === 'redirect') {
    const url = new URL(g.to, req.url)
    if (g.next) url.searchParams.set('next', g.next + req.nextUrl.search)
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
