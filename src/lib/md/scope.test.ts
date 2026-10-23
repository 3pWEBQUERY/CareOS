import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignedResidentIds, assignmentActive, mdMayAccess, mdPermissions } from './scope'
import { stripDisabled } from '../modules'

const now = new Date('2026-10-23T10:00:00+02:00')
const d = (s: string) => new Date(s)

test('Ärzteportal: nur eigene, aktive Zuordnungen geben Zugriff', () => {
  const rows = [
    { residentId: 'r1', userId: 'dr', from: d('2026-01-01'), until: null },
    { residentId: 'r2', userId: 'dr', from: d('2026-01-01'), until: d('2026-10-01') }, // abgelaufen
    { residentId: 'r3', userId: 'dr', from: d('2026-11-01'), until: null }, // beginnt später
    { residentId: 'r4', userId: 'other', from: d('2026-01-01'), until: null }, // andere Ärztin
    { residentId: 'r5', userId: 'dr', from: d('2026-01-01'), until: d('2026-10-24') },
  ]
  assert.deepEqual(assignedResidentIds(rows, 'dr', now).sort(), ['r1', 'r5'])
  assert.deepEqual(assignedResidentIds(rows, 'nobody', now), [])
})

test('Ärzteportal: Ablaufdatum ist exklusiv', () => {
  assert.equal(assignmentActive({ from: d('2026-01-01'), until: now }, now), false)
  assert.equal(assignmentActive({ from: now, until: null }, now), true)
})

test('Ärzteportal: fremde Organisation oder nicht zugeordnete Person wird abgewiesen', () => {
  assert.equal(mdMayAccess({ residentOrgId: 'o1', orgId: 'o1', assignedIds: ['r1'], residentId: 'r1' }), true)
  assert.equal(mdMayAccess({ residentOrgId: 'o2', orgId: 'o1', assignedIds: ['r1'], residentId: 'r1' }), false)
  assert.equal(mdMayAccess({ residentOrgId: 'o1', orgId: 'o1', assignedIds: ['r1'], residentId: 'r2' }), false)
})

test('Ärzteportal: feste Rechte ohne Pflege-, Team- oder Adminrechte; Module wirken', () => {
  const all = mdPermissions()
  assert.ok(all.includes('resident.read') && all.includes('resident.visit.conduct') && all.includes('resident.medication.edit'))
  for (const p of all) assert.ok(!/^(task|handover|team|chat|admin|schedule|learn|docs)\./.test(p), p)
  const noMeds = mdPermissions((p) => stripDisabled(p, ['visit']))
  assert.ok(!noMeds.some((p) => p.startsWith('resident.medication.')))
  assert.ok(noMeds.includes('resident.read'))
})
