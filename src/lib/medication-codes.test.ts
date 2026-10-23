import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSubstanceAtc, isValidAtc, isValidGtin, parseCodes } from './medication-codes'

test('ATC: Ebenen 1–5 gültig, Wirkstoffebene erkannt', () => {
  for (const v of ['B', 'B01', 'B01A', 'B01AA', 'B01AA04', 'N02BE01']) assert.ok(isValidAtc(v), v)
  for (const v of ['b01aa04', 'B1AA04', 'B01AA4', 'B01AA041', '01AA04']) assert.ok(!isValidAtc(v), v)
  assert.equal(isSubstanceAtc('B01AA04'), true)
  assert.equal(isSubstanceAtc('B01AA'), false)
})

test('GTIN: Prüfziffer (Schweizer Packung 7680…)', () => {
  assert.equal(isValidGtin('7680521101306'), true)
  assert.equal(isValidGtin('4006381333931'), true)
  assert.equal(isValidGtin('7680521101307'), false)
  assert.equal(isValidGtin('768052110130'), false)
})

test('Codes: normalisiert, leer erlaubt, Fehler am Feld', () => {
  assert.deepEqual(parseCodes({ atc: ' b01aa04 ', gtin: '7680 5211 0130 6' }), { atc: 'B01AA04', gtin: '7680521101306' })
  assert.deepEqual(parseCodes({ atc: '', gtin: '' }), { atc: null, gtin: null })
  assert.equal(parseCodes({ atc: 'X1', gtin: '' }).error?.field, 'atc')
  assert.equal(parseCodes({ atc: '', gtin: '123' }).error?.field, 'gtin')
})
