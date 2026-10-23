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

test('Speichern mit Konfliktprüfung (Dokument-Entwurf, Übergabe, Pflegebereich)', async () => {
  const { mergeEdit, parseBase } = await import('./merge-check')
  const keys = ['watch', 'open', 'important'] as const
  const base = { watch: 'Atmung', open: null, important: false }
  // Andere Person hat «open» ergänzt, ich ändere «watch»: beides bleibt
  const a = mergeEdit(base, { watch: 'Atmung', open: 'Rückruf Arzt', important: false }, { watch: 'Atmung, Temperatur', open: null, important: false }, keys)
  assert.deepEqual(a.conflicts, [])
  assert.deepEqual(a.data, { watch: 'Atmung, Temperatur', open: 'Rückruf Arzt', important: false })
  // Dasselbe Feld unterschiedlich → Konflikt, nichts speichern
  const b = mergeEdit(base, { watch: 'Atmung engmaschig', open: null, important: false }, { watch: 'Temperatur', open: null, important: false }, keys)
  assert.deepEqual(b.conflicts, ['watch'])
  // Ohne Stand beim Öffnen: eigene Eingabe
  assert.deepEqual(mergeEdit(null, { watch: 'x' }, { watch: 'y', open: null, important: true }, keys).data, { watch: 'y', open: null, important: true })
  assert.equal(parseBase('{kaputt'), null)
  assert.deepEqual(parseBase('{"a":1}'), { a: 1 })
})
