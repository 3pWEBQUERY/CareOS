import { NextResponse, type NextRequest } from 'next/server'

/**
 * Optimistische Prüfung: ohne Sitzungs-Cookie direkt zum Login.
 * Die eigentliche Autorisierung erfolgt serverseitig in jeder Seite und Aktion.
 */
export function proxy(req: NextRequest) {
  if (!req.cookies.has('careos_session')) {
    const url = new URL('/login', req.url)
    if (req.nextUrl.pathname !== '/') url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }
  // Aktueller Pfad für das App-Layout (MFA-Pflicht, PRD §33). Immer überschreiben, nie vom Client übernehmen.
  const fwd = new Headers(req.headers)
  fwd.set('x-careos-path', req.nextUrl.pathname)
  return NextResponse.next({ request: { headers: fwd } })
}

export const config = {
  matcher: ['/((?!login|api|_next|icons/|screenshots/|icon.svg|manifest.webmanifest|sw.js|offline.html|offline|favicon.ico|robots.txt).*)'],
}
