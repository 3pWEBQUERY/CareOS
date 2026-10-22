import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_THRESHOLDS, escalates, evaluateRules, securityThresholds, windowOf, type AuditRow } from './security-rules'

const T0 = new Date('2026-10-22T08:00:00Z').getTime()
const at = (min: number) => new Date(T0 + min * 60_000)
const row = (p: Partial<AuditRow> & { action: string; at: Date }): AuditRow => ({ orgId: 'o1', userId: null, entityType: 'User', entityId: null, ip: null, ...p })
const opts = { thresholds: () => DEFAULT_THRESHOLDS, ipKey: (ip: string) => 'h_' + ip }

test('Muster: Fehlanmeldungen je Konto und je IP', () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => row({ action: 'auth.login_failed', at: at(i), entityId: 'u1', ip: '203.0.113.7' })),
    ...Array.from({ length: 4 }, (_, i) => row({ action: 'auth.login_failed', at: at(i), entityId: 'u2', ip: '203.0.113.7' })),
  ]
  const out = evaluateRules(rows, opts)
  const user = out.find((a) => a.subject === 'user:u1')!
  assert.equal(user.rule, 'login_failures')
  assert.equal(user.severity, 'warning')
  assert.equal(user.count, 5)
  assert.ok(!out.some((a) => a.subject === 'user:u2')) // 4 < 5
  assert.ok(!out.some((a) => a.subject === 'ip:h_203.0.113.7')) // 9 < 15
  const many = Array.from({ length: 16 }, (_, i) => row({ action: 'auth.login_failed', at: at(i % 14), entityId: 'x' + i, ip: '198.51.100.1' }))
  const ip = evaluateRules(many, opts).find((a) => a.subject === 'ip:h_198.51.100.1')!
  assert.equal(ip.severity, 'warning')
  assert.equal(ip.details.accounts, 16)
  assert.equal(ip.userId, null)
})

test('Muster: unbekannte Konten ohne Organisation nur bei genau einer Organisation', () => {
  const rows = Array.from({ length: 6 }, (_, i) => row({ action: 'auth.login_failed', at: at(i), orgId: null, entityId: null, ip: '192.0.2.5' }))
  assert.equal(evaluateRules(rows, { ...opts, thresholds: () => ({ ...DEFAULT_THRESHOLDS, loginIp: [5, 10] }) }).length, 0)
  const out = evaluateRules(rows, { ...opts, soleOrgId: 'o1', thresholds: () => ({ ...DEFAULT_THRESHOLDS, loginIp: [5, 10] }) })
  assert.equal(out.length, 1)
  assert.equal(out[0].orgId, 'o1')
})

test('Muster: Massenzugriff zählt verschiedene Akten, nicht Aufrufe', () => {
  const same = Array.from({ length: 100 }, (_, i) => row({ action: 'resident.view', at: at(i % 14), userId: 'u9', entityType: 'Resident', entityId: 'r1' }))
  assert.equal(evaluateRules(same, opts).length, 0)
  const many = Array.from({ length: 85 }, (_, i) => row({ action: 'resident.view', at: at(i % 14), userId: 'u9', entityType: 'Resident', entityId: 'r' + i }))
  const a = evaluateRules(many, opts)[0]
  assert.equal(a.rule, 'mass_access')
  assert.equal(a.severity, 'critical')
  assert.equal(a.details.residents, 85)
})

test('Muster: Exporte und Rechteänderungen', () => {
  const org = evaluateRules([row({ action: 'admin.export.org', at: at(1), userId: 'a1' })], opts)
  assert.equal(org[0].rule, 'export')
  assert.equal(org[0].severity, 'warning')
  const auditOnly = evaluateRules([row({ action: 'admin.audit.export', at: at(1), userId: 'a1' })], opts)
  assert.equal(auditOnly[0].severity, 'info')
  const two = evaluateRules([1, 2].map((m) => row({ action: 'resident.export', at: at(m), userId: 'n1' })), opts)
  assert.equal(two.length, 0)
  const three = evaluateRules([1, 2, 3].map((m) => row({ action: 'resident.export', at: at(m), userId: 'n1' })), opts)
  assert.equal(three[0].severity, 'warning')
  const perm = evaluateRules([row({ action: 'admin.user.role_assign', at: at(5), userId: 'a1' }), row({ action: 'admin.role.update', at: at(6), userId: 'a1' })], opts)
  assert.equal(perm[0].rule, 'permission_change')
  assert.equal(perm[0].severity, 'info')
  assert.deepEqual(perm[0].details.actions, { 'admin.user.role_assign': 1, 'admin.role.update': 1 })
  // Nicht überwachte Aktionen erzeugen nichts
  assert.equal(evaluateRules([row({ action: 'task.complete', at: at(1), userId: 'u' })], opts).length, 0)
})

test('Muster: feste Zeitfenster, getrennte Fenster zählen getrennt', () => {
  const w = windowOf(new Date('2026-10-22T08:14:59Z'), 15 * 60_000)
  assert.equal(w.start.toISOString(), '2026-10-22T08:00:00.000Z')
  assert.equal(w.end.toISOString(), '2026-10-22T08:15:00.000Z')
  const rows = [...[10, 11, 12].map((m) => row({ action: 'auth.mfa_failed', at: at(m), userId: 'u1' })), ...[16, 17].map((m) => row({ action: 'auth.mfa_failed', at: at(m), userId: 'u1' }))]
  assert.equal(evaluateRules(rows, { ...opts, thresholds: () => ({ ...DEFAULT_THRESHOLDS, mfa: [3, 6] }) }).length, 1)
})

test('Schwellen aus den Einstellungen mit Mindestwerten', () => {
  assert.deepEqual(securityThresholds({}), DEFAULT_THRESHOLDS)
  const t = securityThresholds({ security: { thresholds: { loginUser: [1, 1], massAccess: ['50', '40'], permissionBurst: 0 } } })
  assert.deepEqual(t.loginUser, [3, 4])
  assert.deepEqual(t.massAccess, [50, 51])
  assert.equal(t.permissionBurst, DEFAULT_THRESHOLDS.permissionBurst)
  assert.equal(escalates(null, 'info'), true)
  assert.equal(escalates('warning', 'critical'), true)
  assert.equal(escalates('critical', 'warning'), false)
  assert.equal(escalates('warning', 'warning'), false)
})
