import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTime, parseOp, residentConflict, taskConflict, validateVitals } from './validate'

const now = new Date('2026-10-22T10:00:00+02:00')
const id = '0b6f1c2e-6a8d-4c1e-9d3b-2f5a7c9e1b4d'
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()

test('Offline: Zeitfenster 24 h zurück, 5 min voraus', () => {
  assert.equal(checkTime(new Date(ago(60)), now), null)
  assert.equal(checkTime(new Date(ago(24 * 60 + 1)), now), 'tooOld')
  assert.equal(checkTime(new Date(ago(-4)), now), null)
  assert.equal(checkTime(new Date(ago(-6)), now), 'future')
  assert.equal(checkTime(new Date('kaputt'), now), 'tooOld')
})

test('Offline: Vorgang validieren, Uhrabweichung nach vorne wird auf jetzt gesetzt', () => {
  const ok = parseOp({ id, kind: 'note', residentId: 'r1', at: ago(30), data: { category: 'care', text: 'Gut geschlafen.', important: false } }, now)
  assert.ok('op' in ok)
  const ahead = parseOp({ id, kind: 'note', residentId: 'r1', at: ago(-2), data: { category: 'care', text: 'Gut geschlafen.', important: false } }, now)
  assert.ok('at' in ahead && ahead.at.getTime() === now.getTime())
  const bad = parseOp({ id, kind: 'note', residentId: 'r1', at: ago(30), data: { category: 'gossip', text: 'x', important: false } }, now)
  assert.deepEqual(bad, { id, reason: 'invalid' })
  const old = parseOp({ id, kind: 'intake', residentId: 'r1', at: ago(25 * 60), data: { type: 'drink', ml: 200 } }, now)
  assert.deepEqual(old, { id, reason: 'tooOld' })
  assert.deepEqual(parseOp({ id: 'nicht-uuid', kind: 'note', residentId: 'r1', at: ago(1), data: {} }, now), { id: 'nicht-uuid', reason: 'invalid' })
  assert.ok('reason' in parseOp({ id, kind: 'intake', residentId: 'r1', at: ago(1), data: { type: 'meal', meal: 'lunch', portion: 0.3 } }, now))
  assert.ok('op' in parseOp({ id, kind: 'intake', residentId: 'r1', at: ago(1), data: { type: 'meal', meal: 'lunch', portion: 0.75 } }, now))
  assert.ok('reason' in parseOp({ id, kind: 'unknown', residentId: 'r1', at: ago(1), data: {} }, now))
})

test('Offline: Vitalwerte wie online geprüft', () => {
  assert.deepEqual(validateVitals({ sys: 128, dia: 78, pulse: 72.4 }), { row: { sys: 128, dia: 78, pulse: 72 } })
  assert.deepEqual(validateVitals({ temp: 36.84 }), { row: { temp: 36.8 } })
  assert.deepEqual(validateVitals({ sys: 300, dia: 80 }), { reason: 'implausible' })
  assert.deepEqual(validateVitals({ sys: 120 }), { reason: 'invalid' })
  assert.deepEqual(validateVitals({ sys: 80, dia: 90 }), { reason: 'implausible' })
  assert.deepEqual(validateVitals({}), { reason: 'invalid' })
  assert.deepEqual(validateVitals({ cholesterol: 5 }), { reason: 'invalid' })
})

test('Offline: Konflikte bei Austritt', () => {
  assert.equal(residentConflict({ status: 'active' }), null)
  assert.equal(residentConflict({ status: 'absent' }), null)
  assert.equal(residentConflict({ status: 'discharged' }), 'discharged')
  assert.equal(residentConflict({ status: 'deceased' }), 'discharged')
})

test('Offline: Konflikte bei Aufgaben', () => {
  const at = new Date(ago(30))
  const open = { status: 'planned', source: 'manual', completedById: null, completedAt: null }
  const me = { userId: 'u1', status: 'done', at }
  assert.equal(taskConflict(open, me), null)
  assert.deepEqual(taskConflict(null, me), { status: 'conflict', reason: 'taskNotFound' })
  assert.deepEqual(taskConflict({ ...open, source: 'medication' }, me), { status: 'conflict', reason: 'medOnly' })
  // Bereits von jemand anderem abgeschlossen
  assert.deepEqual(taskConflict({ ...open, status: 'done', completedById: 'u2', completedAt: new Date(ago(10)) }, me), { status: 'conflict', reason: 'taskClosed' })
  // Eigener identischer Abschluss (z. B. Antwort ging verloren): bereits übernommen
  assert.deepEqual(taskConflict({ ...open, status: 'done', completedById: 'u1', completedAt: new Date(ago(10)) }, me), { status: 'duplicate' })
  // Eigener, aber anderer Status: Konflikt
  assert.deepEqual(taskConflict({ ...open, status: 'skipped', completedById: 'u1', completedAt: new Date(ago(10)) }, me), { status: 'conflict', reason: 'taskClosed' })
  // Nach der Erfassung von jemand anderem geändert (z. B. wieder geöffnet)
  assert.deepEqual(taskConflict(open, me, { by: 'u2', at: new Date(ago(5)) }), { status: 'conflict', reason: 'taskChanged' })
  assert.equal(taskConflict(open, me, { by: 'u2', at: new Date(ago(60)) }), null)
})
