import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PORTAL_COOKIE, PORTAL_COOKIE_PATH, STAFF_COOKIE, gate, isPortalPath, safePortalNext } from './routing'
import { PORTAL_INVITE_DAYS, inviteExpiry, inviteProblem, normalizeEmail, tokenShapeOk } from './invite-core'

const jar = (...names: string[]) => ({ has: (n: string) => names.includes(n) })

test('Sitzungs-Trennung: eigene Cookies, Portal-Cookie nur unter /portal', () => {
  assert.notEqual(PORTAL_COOKIE, STAFF_COOKIE)
  assert.equal(PORTAL_COOKIE_PATH, '/portal')
  assert.equal(isPortalPath('/portal'), true)
  assert.equal(isPortalPath('/portal/messages'), true)
  assert.equal(isPortalPath('/portals'), false)
  assert.equal(isPortalPath('/team/family'), false)
})

test('Proxy: Portal-Cookie öffnet keine Seite der Stationsapp', () => {
  assert.deepEqual(gate('/residents/x', jar(PORTAL_COOKIE)), { kind: 'redirect', to: '/login', next: '/residents/x' })
  assert.deepEqual(gate('/', jar(PORTAL_COOKIE)), { kind: 'redirect', to: '/login', next: undefined })
  assert.deepEqual(gate('/team/family', jar(PORTAL_COOKIE)), { kind: 'redirect', to: '/login', next: '/team/family' })
  assert.deepEqual(gate('/residents/x', jar(STAFF_COOKIE)), { kind: 'next' })
})

test('Proxy: Sitzung der Mitarbeitenden öffnet das Portal nicht', () => {
  assert.deepEqual(gate('/portal', jar(STAFF_COOKIE)), { kind: 'redirect', to: '/portal/login', next: undefined })
  assert.deepEqual(gate('/portal/messages', jar(STAFF_COOKIE)), { kind: 'redirect', to: '/portal/login', next: '/portal/messages' })
  assert.deepEqual(gate('/portal/messages', jar(PORTAL_COOKIE)), { kind: 'next' })
})

test('Proxy: öffentlich nur Anmeldung und Einladung', () => {
  assert.deepEqual(gate('/portal/login', jar()), { kind: 'next' })
  assert.deepEqual(gate('/portal/login/mfa', jar()), { kind: 'next' })
  assert.deepEqual(gate('/portal/invite', jar()), { kind: 'next' })
  assert.equal(gate('/portal/account', jar()).kind, 'redirect')
  assert.equal(gate('/portal/files/abc', jar()).kind, 'redirect')
  assert.deepEqual(gate('/login', jar()), { kind: 'next' })
  assert.equal(gate('/portal/loginx', jar()).kind, 'redirect')
})

test('Weiterleitung nach Portal-Anmeldung bleibt im Portal', () => {
  assert.equal(safePortalNext('/portal/messages/1'), '/portal/messages/1')
  assert.equal(safePortalNext('/residents/1'), '/portal')
  assert.equal(safePortalNext('//evil.example/portal'), '/portal')
  assert.equal(safePortalNext('https://evil.example'), '/portal')
  assert.equal(safePortalNext('/portal/login'), '/portal')
  assert.equal(safePortalNext(null), '/portal')
})

test('Einladung: einmalig, Ablauf, Widerruf', () => {
  const now = new Date('2026-10-23T10:00:00')
  const valid = { inviteTokenHash: 'h', inviteExpiresAt: new Date('2026-10-25'), acceptedAt: null, revokedAt: null }
  assert.equal(inviteProblem(valid, now), null)
  assert.equal(inviteProblem(null, now), 'invalid')
  assert.equal(inviteProblem({ ...valid, inviteExpiresAt: new Date('2026-10-23T09:59:59') }, now), 'expired')
  assert.equal(inviteProblem({ ...valid, inviteExpiresAt: null }, now), 'expired')
  assert.equal(inviteProblem({ ...valid, revokedAt: now }, now), 'revoked')
  assert.equal(inviteProblem({ ...valid, acceptedAt: now }, now), 'used')
  // nach der Annahme ist der Hash gelöscht
  assert.equal(inviteProblem({ ...valid, inviteTokenHash: null, acceptedAt: now }, now), 'used')
  assert.equal(inviteExpiry(now).getTime() - now.getTime(), PORTAL_INVITE_DAYS * 86400_000)
  assert.equal(tokenShapeOk('a'.repeat(43)), true)
  assert.equal(tokenShapeOk('short'), false)
  assert.equal(tokenShapeOk("x'; DROP TABLE".padEnd(40, 'x')), false)
  assert.equal(normalizeEmail('  Anna@Example.CH '), 'anna@example.ch')
})
