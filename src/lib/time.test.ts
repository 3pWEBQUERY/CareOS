import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtDayMonth, fmtRel } from './time'
import { dueView } from './task-view'

const L = { today: 'heute', yesterday: 'gestern' }

test('Kurzdatum je Sprache: Punkt in DE/FR/IT (Schweiz), Schrägstrich in EN', () => {
  const d = new Date(2026, 9, 2, 9, 5)
  assert.equal(fmtDayMonth(d), '02.10.')
  assert.equal(fmtDayMonth(d, 'de'), '02.10.')
  assert.equal(fmtDayMonth(d, 'fr'), '02.10.')
  assert.equal(fmtDayMonth(d, 'it'), '02.10.')
  assert.equal(fmtDayMonth(d, 'en'), '02/10')
})

test('Relatives Datum: heute, gestern, sonst Kurzdatum der Sprache', () => {
  const now = new Date(2026, 9, 22, 14, 0)
  assert.equal(fmtRel(new Date(2026, 9, 22, 8, 10), L, now, 'en'), 'heute 08:10')
  assert.equal(fmtRel(new Date(2026, 9, 21, 23, 59), L, now, 'en'), 'gestern 23:59')
  assert.equal(fmtRel(new Date(2026, 9, 12, 9, 30), L, now), '12.10. 09:30')
  assert.equal(fmtRel(new Date(2026, 9, 12, 9, 30), L, now, 'fr'), '12.10. 09:30')
  assert.equal(fmtRel(new Date(2026, 9, 12, 9, 30), L, now, 'en'), '12/10 09:30')
  // Jahreswechsel: «gestern» über den Monats-/Jahreswechsel
  assert.equal(fmtRel(new Date(2025, 11, 31, 22, 0), L, new Date(2026, 0, 1, 6, 0), 'it'), 'gestern 22:00')
})

test('Aufgabenstatus aus der Fälligkeit (auch clientseitig nach dem Wiederöffnen)', () => {
  const now = new Date(2026, 9, 22, 10, 0)
  assert.equal(dueView(new Date(2026, 9, 22, 9, 44), now), 'over')
  assert.equal(dueView(new Date(2026, 9, 22, 9, 45), now), 'due')
  assert.equal(dueView(new Date(2026, 9, 22, 10, 30), now), 'due')
  assert.equal(dueView(new Date(2026, 9, 22, 10, 31), now), 'up')
})
