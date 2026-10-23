import { test } from 'node:test'
import assert from 'node:assert/strict'
import { absenceNights, billingCsvRows, daysWithin, monthRange } from './billing-core'
import { timeReturned } from './usage-core'

test('Abrechnung: Aufenthalts- und Abwesenheitstage im Monat', () => {
  const { start, end } = monthRange('2026-10')!
  assert.equal(daysWithin(new Date(2026, 8, 1), null, start, end), 31)
  assert.equal(daysWithin(new Date(2026, 9, 20, 14), null, start, end), 12)
  assert.equal(daysWithin(new Date(2026, 8, 1), new Date(2026, 9, 5, 9), start, end), 5)
  // Spital 10.10. bis 14.10.: Nächte 11.–13. ausserhalb
  assert.equal(absenceNights(new Date(2026, 9, 10, 9), new Date(2026, 9, 14, 16), start, end), 3)
  // laufend seit 30.9.: 1.–31.10.
  assert.equal(absenceNights(new Date(2026, 8, 30, 9), null, start, end), 31)
  assert.equal(monthRange('2026-13'), null)
  const rows = billingCsvRows([{ lastName: 'A', firstName: 'B', birthDate: '1940-01-01', insuranceNo: null, unit: 'WG 1', careLevel: 6, stayDays: 31, absenceDays: 0, careMinutes: 90, services: 9, byCategory: { Grundpflege: 60, Medikation: 30 } }], { base: Array(11).fill('x'), category: (c) => 'Min ' + c })
  assert.deepEqual(rows[0].slice(11), ['Min Grundpflege', 'Min Medikation'])
  assert.deepEqual(rows[1].slice(8, 13), ['90', '1.50', '9', '60', '30'])
})

test('Time returned to care: Schätzung aus Zählwerten, kleine Gruppen ohne Zahl', () => {
  const r = timeReturned({ bulk: 120, handover: 30, aiAccepted: 10, voice: 20, documentOnce: 200 }, 10)
  assert.equal(r.totalMin, 60 + 300 + 30 + 30 + 100)
  assert.equal(r.perUserWeekMin, Math.round(520 / 10 / (30 / 7)))
  assert.equal(timeReturned({ bulk: 1, handover: 0, aiAccepted: 0, voice: 0, documentOnce: 0 }, 2).perUserWeekMin, null)
})
