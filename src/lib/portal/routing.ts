/**
 * Trennung der Sitzungen (PRD §37): Mitarbeitende und Angehörige haben eigene Cookies, eigene Tabellen und
 * eigene Prüfungen. Rein, damit Proxy und Tests dieselben Regeln verwenden.
 *
 * - Stationsapp: Cookie `careos_session` (Pfad /), geprüft nur von src/lib/auth/session.ts.
 * - Portal: Cookie `careos_portal` (Pfad /portal – der Browser sendet es an keine andere Route),
 *   geprüft nur von src/lib/portal/auth.ts. Ein Portal-Cookie öffnet nie eine Seite der Stationsapp
 *   und umgekehrt.
 */
export const STAFF_COOKIE = 'careos_session'
export const PORTAL_COOKIE = 'careos_portal'
export const PORTAL_COOKIE_PATH = '/portal'
/** Gewählte Person bei mehreren Zugängen (nur Auswahl, keine Berechtigung). */
export const PORTAL_RESIDENT_COOKIE = 'careos_portal_r'

/** Öffentliche Seiten der Stationsapp. */
const STAFF_PUBLIC = /^\/(login|register|offline)(\/|$)/
/** Öffentliche Seiten des Portals: Anmeldung und Einladung. */
const PORTAL_PUBLIC = /^\/portal\/(login|invite)(\/|$)/

export const isPortalPath = (path: string) => path === '/portal' || path.startsWith('/portal/')

export type Gate = { kind: 'next' } | { kind: 'redirect'; to: string; next?: string }

/**
 * Optimistische Prüfung im Proxy (die eigentliche Prüfung erfolgt in jeder Seite und Aktion):
 * Portal-Pfade brauchen das Portal-Cookie, alle übrigen das Cookie der Mitarbeitenden.
 * Das jeweils andere Cookie zählt nie.
 */
export function gate(path: string, cookies: { has(name: string): boolean }): Gate {
  if (isPortalPath(path)) {
    if (PORTAL_PUBLIC.test(path) || cookies.has(PORTAL_COOKIE)) return { kind: 'next' }
    return { kind: 'redirect', to: '/portal/login', next: path === '/portal' ? undefined : path }
  }
  if (STAFF_PUBLIC.test(path) || cookies.has(STAFF_COOKIE)) return { kind: 'next' }
  return { kind: 'redirect', to: '/login', next: path === '/' ? undefined : path }
}

/** Weiterleitung nach der Anmeldung im Portal: nur Portal-Pfade, nie in die Stationsapp. */
export function safePortalNext(n: unknown) {
  const s = typeof n === 'string' ? n : ''
  return isPortalPath(s) && !s.startsWith('//') && !PORTAL_PUBLIC.test(s) ? s : '/portal'
}
