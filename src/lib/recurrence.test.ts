import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeRecurrence, nextOccurrence, occursOn, RecurrenceInput, type Recurrence } from './recurrence'
import { makeT } from '@/i18n/core'
import { dictionary } from '@/i18n'

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d)
const rec = (r: Partial<Recurrence>): Recurrence => ({ rhythm: 'daily', every: 1, weekdays: [], monthDay: null, startDate: D(2026, 10, 1), endDate: null, ...r })
const days = (r: Recurrence, from: Date, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)).filter((d) => occursOn(r, d)).map((d) => d.getDate())

test('Täglich und alle n Tage ab Startdatum, nicht davor und nicht nach dem Ende', () => {
  assert.deepEqual(days(rec({}), D(2026, 9, 29), 5), [1, 2, 3])
  assert.deepEqual(days(rec({ every: 3 }), D(2026, 10, 1), 10), [1, 4, 7, 10])
  assert.deepEqual(days(rec({ endDate: D(2026, 10, 3) }), D(2026, 10, 1), 5), [1, 2, 3])
})

test('Über die Umstellung auf Winterzeit (25.10.2026) bleibt der Rhythmus stabil', () => {
  assert.deepEqual(days(rec({ every: 2, startDate: D(2026, 10, 24) }), D(2026, 10, 24), 6), [24, 26, 28])
})

test('Wöchentlich an gewählten Wochentagen, alle 2 Wochen ab der Startwoche', () => {
  // 01.10.2026 = Donnerstag; Mo = 1, Do = 4
  const weekly = rec({ rhythm: 'weekly', weekdays: [1, 4] })
  assert.deepEqual(days(weekly, D(2026, 10, 1), 14), [1, 5, 8, 12])
  const biweekly = rec({ rhythm: 'weekly', weekdays: [1], every: 2, startDate: D(2026, 10, 5) })
  assert.deepEqual(days(biweekly, D(2026, 10, 1), 31), [5, 19])
  // ohne Wochentage: Wochentag des Starts
  assert.deepEqual(days(rec({ rhythm: 'weekly' }), D(2026, 10, 1), 15), [1, 8, 15])
})

test('Monatlich am Tag X; in kürzeren Monaten am letzten Tag', () => {
  const m31 = rec({ rhythm: 'monthly', monthDay: 31, startDate: D(2026, 1, 1) })
  assert.equal(occursOn(m31, D(2026, 2, 28)), true)
  assert.equal(occursOn(m31, D(2026, 2, 27)), false)
  assert.equal(occursOn(m31, D(2026, 4, 30)), true)
  assert.equal(occursOn(m31, D(2026, 5, 31)), true)
  const quarterly = rec({ rhythm: 'monthly', every: 3, monthDay: 1, startDate: D(2026, 1, 1) })
  assert.equal(occursOn(quarterly, D(2026, 4, 1)), true)
  assert.equal(occursOn(quarterly, D(2026, 5, 1)), false)
})

test('Nächster Termin', () => {
  const r = rec({ rhythm: 'weekly', weekdays: [1], startDate: D(2026, 10, 1) })
  assert.deepEqual(nextOccurrence(r, D(2026, 10, 1)), D(2026, 10, 5))
  assert.equal(nextOccurrence(rec({ endDate: D(2026, 10, 2) }), D(2026, 10, 3)), null)
})

test('Eingabe: Zeiten normalisiert, Fehler als i18n-Schlüssel', () => {
  const ok = RecurrenceInput.parse({ rhythm: 'weekly', every: '1', weekdays: ['1', '4'], monthDay: '', times: '7.30, 14:00 07:30', startDate: '2026-10-22', endDate: '' })
  assert.deepEqual(ok.times, ['07:30', '14:00'])
  assert.equal(ok.monthDay, null)
  const bad = RecurrenceInput.safeParse({ rhythm: 'daily', every: '1', weekdays: [], monthDay: '', times: '25:00', startDate: '2026-10-22', endDate: '' })
  assert.equal(bad.success, false)
  assert.equal(bad.error?.issues[0].message, 'tasks.recur.errors.times')
  const end = RecurrenceInput.safeParse({ rhythm: 'daily', every: '1', weekdays: [], monthDay: '', times: '08:00', startDate: '2026-10-22', endDate: '2026-10-01' })
  assert.equal(end.error?.issues[0].message, 'tasks.recur.errors.end')
})

test('Beschreibung in allen Sprachen ohne rohe Schlüssel', () => {
  for (const l of ['de', 'fr', 'it', 'en'] as const) {
    const t = makeT(dictionary(l), l, 'resident')
    const s = [
      describeRecurrence(t, rec({}), ['07:00']),
      describeRecurrence(t, rec({ rhythm: 'weekly', weekdays: [1, 4], every: 2 })),
      describeRecurrence(t, rec({ rhythm: 'monthly', monthDay: 1 })),
    ].join(' | ')
    assert.doesNotMatch(s, /tasks\.|\{/, l + ': ' + s)
  }
  const t = makeT(dictionary('de'), 'de', 'resident')
  assert.equal(describeRecurrence(t, rec({}), ['07:00']), 'Täglich · 07:00')
  assert.equal(describeRecurrence(t, rec({ rhythm: 'weekly', weekdays: [4, 1], every: 2 })), 'Alle 2 Wochen: Mo, Do')
})
