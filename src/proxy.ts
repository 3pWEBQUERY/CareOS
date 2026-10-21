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
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!login|api|_next|icon.svg|manifest.webmanifest|sw.js|favicon.ico).*)'],
}
