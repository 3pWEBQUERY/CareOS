import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODULE_KEYS, moduleOfApiPath, moduleOfPath, moduleOfPermission, normalizeModules, orgHasModule, setModule, stripDisabled } from './modules'
import { EMERGENCY_MAX_MINUTES, emergencyActive, emergencyExpiry, emergencyGrant, emergencyRemaining, emergencySchema, emergencyStatus } from './emergency-core'
import { allowedScopes, personalTokenSchema, scopesBeyond, tokenExpiry, tokenState } from './api-tokens'
import { clinicalPermissions, slimSysadmin } from './least-privilege'
import { canTransition, orgStatus, platformAdminEmails, isPlatformOperator, fmtBytes } from './platform-core'
import { DEFAULT_ROLES, hasPermission, type Grant } from './permissions'

test('Module: Berechtigungen, Pfade, API und Aliase', () => {
  assert.equal(moduleOfPermission('resident.medication.administer'), 'medication')
  assert.equal(moduleOfPermission('resident.chart.dictate'), 'dictation')
  assert.equal(moduleOfPermission('resident.chart.write'), null)
  assert.equal(moduleOfPermission('ai.use'), 'ai')
  assert.equal(moduleOfPermission('admin.config'), null)
  assert.equal(moduleOfPath('/tasks/medround'), 'medication')
  assert.equal(moduleOfPath('/residents/abc/meds'), 'medication')
  assert.equal(moduleOfPath('/residents/abc/notes'), null)
  assert.equal(moduleOfPath('/tasks'), null)
  assert.equal(moduleOfPath('/learn/course/1'), 'learn')
  assert.equal(moduleOfPath('/learning'), null) // nur ganze Segmente
  assert.equal(moduleOfApiPath('/api/fhir/MedicationStatement'), 'medication')
  assert.equal(moduleOfApiPath('/api/fhir/Patient'), null)
  assert.equal(orgHasModule({ modules: ['learn'] }, 'core'), true)
  assert.equal(orgHasModule({ modules: ['learn'] }, 'nursing'), true)
  assert.equal(orgHasModule({ modules: ['learn'] }, 'clinical_plus'), false)
  assert.equal(orgHasModule({ modules: ['medication'] }, 'clinical_plus'), true)
  assert.equal(orgHasModule({ modules: ['learn'] }, 'workforce'), true)
  assert.equal(orgHasModule(null, 'ai'), true) // ohne Angabe: alles aktiv
  assert.deepEqual(normalizeModules(['ai', 'x', 'ai', 'chat']), ['chat', 'ai'])
  assert.deepEqual(setModule(MODULE_KEYS, 'ai', false).includes('ai'), false)
})

test('Module: abgeschaltete Module entfernen ihre Berechtigungen (zentrale Prüfung)', () => {
  const nurse = DEFAULT_ROLES.find((r) => r.key === 'nurse')!.permissions
  const on = MODULE_KEYS.filter((k) => k !== 'medication' && k !== 'chat')
  const p = stripDisabled(nurse, on)
  assert.ok(!p.some((x) => x.startsWith('resident.medication.')))
  assert.ok(!p.includes('chat.use') && !p.includes('chat.clinical'))
  assert.ok(p.includes('resident.chart.write') && p.includes('task.complete'))
  assert.deepEqual(stripDisabled(nurse, MODULE_KEYS), nurse)
  const grants: Grant[] = [{ permissions: p, unitId: 'u1', locationId: null }]
  assert.equal(hasPermission(grants, 'resident.medication.administer', { unitId: 'u1' }), false)
})

test('Notfallzugriff: Ablauf, Grant nur lesend, Höchstdauer, Validierung', () => {
  const start = new Date('2026-10-23T10:00:00Z')
  const a = { startedAt: start, expiresAt: emergencyExpiry(start, 60), endedAt: null }
  assert.equal(a.expiresAt.toISOString(), '2026-10-23T11:00:00.000Z')
  assert.equal(emergencyExpiry(start, 10_000).getTime() - start.getTime(), EMERGENCY_MAX_MINUTES * 60_000)
  const during = new Date('2026-10-23T10:30:00Z')
  const after = new Date('2026-10-23T11:00:01Z')
  assert.equal(emergencyActive(a, during), true)
  assert.equal(emergencyActive(a, after), false)
  assert.equal(emergencyActive({ ...a, endedAt: during }, during), false)
  assert.equal(emergencyRemaining(a, during), 30)
  const g = emergencyGrant(a, during)!
  assert.equal(g.unitId, null)
  assert.ok(g.permissions.includes('resident.read'))
  assert.ok(!g.permissions.some((p) => p.includes('write') || p.includes('edit') || p.includes('administer') || p === 'task.complete'))
  assert.equal(emergencyGrant(a, after), null)
  assert.equal(emergencyStatus(a, during), 'active')
  assert.equal(emergencyStatus({ ...a, endedAt: a.expiresAt }, after), 'expired')
  assert.equal(emergencyStatus({ ...a, endedAt: during, endedById: 'u' }, after), 'ended')
  assert.equal(emergencySchema.safeParse({ reason: 'zu kurz', minutes: '60', confirm: 'on' }).success, false)
  assert.equal(emergencySchema.safeParse({ reason: 'Störung Medikationsplan WG 2, Auftrag PDL', minutes: '45', confirm: 'on' }).success, false)
  assert.equal(emergencySchema.safeParse({ reason: 'Störung Medikationsplan WG 2, Auftrag PDL', minutes: '60' }).success, false)
  assert.equal(emergencySchema.safeParse({ reason: 'Störung Medikationsplan WG 2, Auftrag PDL', minutes: '60', confirm: 'on' }).success, true)
})

test('Persönliche Tokens: Scopes nur mit organisationsweiten Berechtigungen, Ablauf', () => {
  const role = (key: string) => DEFAULT_ROLES.find((r) => r.key === key)!.permissions
  const orgWide: Grant[] = [{ permissions: role('nursing_director'), unitId: null, locationId: null }]
  const unitOnly: Grant[] = [{ permissions: role('nursing_director'), unitId: 'u1', locationId: null }]
  assert.ok(allowedScopes(orgWide).includes('residents:read'))
  assert.ok(allowedScopes(orgWide).includes('tasks:write'))
  assert.ok(!allowedScopes(orgWide).includes('labs:write')) // nur admin.integrations
  assert.deepEqual(allowedScopes(unitOnly), []) // Bereichsrolle → keine organisationsweiten Scopes
  const sys: Grant[] = [{ permissions: role('sysadmin'), unitId: null, locationId: null }]
  assert.deepEqual(scopesBeyond(['residents:read', 'labs:write'], sys), ['residents:read']) // Admin ohne Akte
  assert.deepEqual(scopesBeyond(['labs:write'], sys), [])
  const now = new Date('2026-10-23T10:00:00Z')
  assert.equal(tokenExpiry(30, now).toISOString(), '2026-11-22T10:00:00.000Z')
  assert.equal(tokenExpiry(9999, now).getTime() - now.getTime(), 365 * 86_400_000)
  assert.equal(tokenState({ revokedAt: null, expiresAt: new Date('2026-10-23T09:00:00Z') }, now), 'expired')
  assert.equal(tokenState({ revokedAt: null, expiresAt: null }, now), 'active')
  assert.equal(tokenState({ revokedAt: now, expiresAt: null }, now), 'revoked')
  assert.equal(personalTokenSchema.safeParse({ name: 'x', days: '30', scopes: ['tasks:read'] }).success, true)
  assert.equal(personalTokenSchema.safeParse({ name: 'x', days: '31', scopes: ['tasks:read'] }).success, false)
  assert.equal(personalTokenSchema.safeParse({ name: 'x', days: '30', scopes: ['admin:all'] }).success, false)
})

test('Least Privilege: Systemadministration verschlanken behält Anpassungen', () => {
  const all = ['resident.read', 'resident.medication.edit', 'task.manage', 'handover.read', 'chat.clinical', 'ai.use', 'docs.manage', 'admin.roles', 'admin.users']
  assert.deepEqual(clinicalPermissions(all), ['resident.read', 'resident.medication.edit', 'task.manage', 'handover.read', 'chat.clinical', 'ai.use'])
  const slim = slimSysadmin(all)
  assert.deepEqual(clinicalPermissions(slim), [])
  assert.ok(slim.includes('docs.manage') && slim.includes('admin.roles') && slim.includes('admin.emergency') && slim.includes('api.personal'))
})

test('Plattform: Betreiber, Status, Übergänge', () => {
  assert.deepEqual(platformAdminEmails({ PLATFORM_ADMIN_EMAILS: ' A.Sulschani@icloud.com, ops@example.ch;bad ' }), ['a.sulschani@icloud.com', 'ops@example.ch'])
  assert.deepEqual(platformAdminEmails({}), [])
  assert.equal(isPlatformOperator({ platformRole: 'operator' }), true)
  assert.equal(isPlatformOperator({ platformRole: 'operator', active: false }), false)
  assert.equal(isPlatformOperator({ platformRole: null }), false)
  assert.equal(orgStatus({ suspendedAt: new Date(), suspendedReason: 'pending' }), 'pending')
  assert.equal(orgStatus({ suspendedAt: new Date(), suspendedReason: 'Zahlung' }), 'suspended')
  assert.equal(orgStatus({ suspendedAt: null, suspendedReason: null }), 'active')
  assert.equal(canTransition('active', 'suspend', true), false) // eigene Organisation
  assert.equal(canTransition('active', 'suspend', false), true)
  assert.equal(canTransition('pending', 'approve', false), true)
  assert.equal(canTransition('active', 'approve', false), false)
  assert.equal(canTransition('suspended', 'unsuspend', false), true)
  assert.equal(fmtBytes(1536), '1.5 KB')
})
