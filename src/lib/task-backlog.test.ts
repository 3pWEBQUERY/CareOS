import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backlogCutoff, inBacklogWindow, isOverdue, isSlotBound, shouldExpire, splitMinutes } from './task-backlog'

const SHIFTS = [
  { code: 'early', name: 'Frühdienst', start: '07:00', end: '15:30' },
  { code: 'late', name: 'Spätdienst', start: '14:45', end: '23:00' },
  { code: 'night', name: 'Nachtdienst', start: '22:45', end: '07:15' },
]
const at = (d: string) => new Date(d)

test('Rückstand: eskalierte Aufgaben zählen als überfällig (eine Zahl)', () => {
  const now = at('2026-10-23T15:30:00')
  assert.equal(isOverdue({ status: 'escalated', dueAt: at('2026-10-23T10:00:00') }, now), true)
  assert.equal(isOverdue({ status: 'planned', dueAt: at('2026-10-23T15:20:00') }, now), false) // innerhalb 15 Min.
  assert.equal(isOverdue({ status: 'done', dueAt: at('2026-10-23T10:00:00') }, now), false)
})

test('Rückstand: Grenze ist der Beginn der Vorschicht', () => {
  // Spätdienst läuft (15:30) → Vorschicht Frühdienst ab 07:00
  assert.deepEqual(backlogCutoff(SHIFTS, at('2026-10-23T15:30:00')), at('2026-10-23T07:00:00'))
  // Nachtdienst nach Mitternacht → Vorschicht Spätdienst des Vortags
  assert.deepEqual(backlogCutoff(SHIFTS, at('2026-10-24T02:00:00')), at('2026-10-23T14:45:00'))
  // ohne Schichtmodell 24 Stunden
  assert.deepEqual(backlogCutoff([], at('2026-10-23T12:00:00')), at('2026-10-22T12:00:00'))
})

test('Rückstand: Routine aus Plan und Serie läuft ab, Einzelaufgaben bleiben', () => {
  const now = at('2026-10-23T15:30:00')
  const cutoff = backlogCutoff(SHIFTS, now)
  const old = at('2026-10-22T18:00:00')
  assert.equal(isSlotBound({ source: 'careplan', sourceId: 'iv1' }), true)
  assert.equal(isSlotBound({ source: 'careplan', sourceId: 'eval:r1:mobility' }), false)
  assert.equal(isSlotBound({ source: 'manual', sourceId: null }), false)
  assert.equal(shouldExpire({ source: 'medication', sourceId: 'r1:08:00', status: 'escalated', dueAt: old }, cutoff), true)
  assert.equal(shouldExpire({ source: 'manual', sourceId: null, status: 'planned', dueAt: old }, cutoff), false)
  assert.equal(shouldExpire({ source: 'recurring', sourceId: 't1', status: 'planned', dueAt: at('2026-10-23T08:00:00') }, cutoff), false)
  assert.equal(inBacklogWindow({ source: 'careplan', sourceId: 'iv1', status: 'planned', dueAt: old }, cutoff, now), false)
  assert.equal(inBacklogWindow({ source: 'order', sourceId: 'o1', status: 'planned', dueAt: old }, cutoff, now), true)
  // älter als 7 Tage: auch Einzelaufgaben nicht mehr in Listen und Zählern
  assert.equal(inBacklogWindow({ source: 'order', sourceId: 'o1', status: 'planned', dueAt: at('2026-10-10T08:00:00') }, cutoff, now), false)
})

test('Pflegezeit in Stunden und Minuten', () => {
  assert.deepEqual(splitMinutes(1815), { h: 30, m: 15 })
  assert.deepEqual(splitMinutes(45), { h: 0, m: 45 })
})
