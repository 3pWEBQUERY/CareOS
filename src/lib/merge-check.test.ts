import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapshot, threeWay } from './merge-check'

const K = ['allergies', 'mobility', 'birthDate', 'careLevel'] as const
const base = snapshot({ allergies: ['Penicillin'], mobility: 'Rollator', birthDate: new Date(Date.UTC(1936, 2, 4)), careLevel: 6 }, K)

test('Konflikt: getrennte Felder werden zusammengeführt', () => {
  const current = { ...base, allergies: ['Penicillin', 'Latex'] }
  const mine = { ...base, mobility: 'Rollstuhl' }
  const r = threeWay(base, current, mine, K)
  assert.deepEqual(r.conflicts, [])
  assert.deepEqual(r.merged.allergies, ['Penicillin', 'Latex'])
  assert.equal(r.merged.mobility, 'Rollstuhl')
})

test('Konflikt: dasselbe Feld unterschiedlich geändert', () => {
  const r = threeWay(base, { ...base, careLevel: 7 }, { ...base, careLevel: 8 }, K)
  assert.deepEqual(r.conflicts, ['careLevel'])
})

test('Konflikt: gleiche Änderung auf beiden Seiten ist kein Konflikt; Datum über ISO verglichen', () => {
  const r = threeWay(base, { ...base, careLevel: 7 }, { ...base, careLevel: 7, birthDate: new Date(Date.UTC(1936, 2, 4)) }, K)
  assert.deepEqual(r.conflicts, [])
  assert.deepEqual(r.mineChanged, ['careLevel'])
})
