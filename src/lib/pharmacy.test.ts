import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expiryState, receiptSchema, reorderSuggestion, stockAfter } from './pharmacy'

const now = new Date('2026-10-23T10:00:00')
const reg = (stock: number | null, daily = 2) => ({ kind: 'regular' as const, stock, daily, prnMaxPerDay: null, endDate: null })

test('Apotheke: Vorschlag erst unter 10 Tagen Reichweite, Ziel 30 Tage', () => {
  assert.equal(reorderSuggestion(reg(40), now), null) // 20 Tage
  assert.equal(reorderSuggestion(reg(18), now), 42) // 9 Tage → 60 − 18
  assert.equal(reorderSuggestion(reg(null), now), null)
  assert.equal(reorderSuggestion(reg(5, 0), now), null) // ohne Tagesdosis nicht berechenbar
})

test('Apotheke: befristete Verordnung nur bis zum Ende, Reserve nach Tageshöchstdosis', () => {
  const tmp = { ...reg(2, 1), kind: 'temporary' as const, endDate: new Date('2026-10-27T00:00:00') }
  assert.equal(reorderSuggestion(tmp, now), 3) // 5 Tage Bedarf − 2
  const prn = { kind: 'prn' as const, stock: 3, daily: 0, prnMaxPerDay: 4, endDate: null }
  assert.equal(reorderSuggestion(prn, now), 37)
  assert.equal(reorderSuggestion({ ...prn, stock: 20 }, now), null)
})

test('Apotheke: Bestand nie negativ, Verfall, Wareneingang mit Charge', () => {
  assert.equal(stockAfter(3, -5), 0)
  assert.equal(stockAfter(null, 20), 20)
  assert.equal(expiryState(new Date('2026-10-01'), now), 'expired')
  assert.equal(expiryState(new Date('2026-11-10'), now), 'soon')
  assert.equal(expiryState(new Date('2027-06-30'), now), 'ok')
  assert.equal(receiptSchema.safeParse({ medicationId: 'm', orderId: '', quantity: '30', batch: '', expiry: '2027-06-30' }).success, false)
  assert.equal(receiptSchema.safeParse({ medicationId: 'm', orderId: '', quantity: '30', batch: 'A123', expiry: '2027-06-30' }).success, true)
})
