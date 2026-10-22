import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkNumber, decimalSeparator, formatNumberInput, initialNumber, parseNumber, plausibility, stepNumber } from './number-input'
import { filterOptions, groupOptions, nextEnabled, normalize } from './combobox'

test('Dezimalzeichen je Sprache (Intl)', () => {
  assert.equal(decimalSeparator('de'), '.')
  assert.equal(decimalSeparator('fr'), ',')
  assert.equal(decimalSeparator('it'), '.')
  assert.equal(decimalSeparator('en'), '.')
})

test('Zahlen parsen: Komma und Punkt in allen Sprachen', () => {
  for (const l of ['de', 'fr', 'it', 'en'] as const) {
    assert.equal(parseNumber('38,1', l), 38.1)
    assert.equal(parseNumber('38.1', l), 38.1)
    assert.equal(parseNumber(' 72 ', l), 72)
    assert.equal(parseNumber('0,5', l), 0.5)
    assert.equal(parseNumber(',5', l), 0.5)
    assert.equal(parseNumber('-2,5', l), -2.5)
    assert.equal(parseNumber('−2.5', l), -2.5)
    assert.equal(parseNumber('+3', l), 3)
    assert.equal(parseNumber('', l), '')
    assert.equal(parseNumber('   ', l), '')
    assert.equal(parseNumber('abc', l), null)
    assert.equal(parseNumber('1,2,3', l), null)
    assert.equal(parseNumber('38,1.2', l), null)
    assert.equal(parseNumber('.', l), null)
    assert.equal(parseNumber('5 mg', l), null)
  }
})

test('Zahlen parsen: Tausendertrennzeichen', () => {
  assert.equal(parseNumber("12'345.5", 'de'), 12345.5)
  assert.equal(parseNumber('12’345,5', 'de'), 12345.5)
  assert.equal(parseNumber('12 345,5', 'fr'), 12345.5)
  assert.equal(parseNumber('12 345,5', 'fr'), 12345.5)
  assert.equal(parseNumber('1.234,5', 'de'), 1234.5)
  assert.equal(parseNumber('1,234.5', 'en'), 1234.5)
  assert.equal(parseNumber('1,500', 'en'), 1500)
  assert.equal(parseNumber('1,500', 'de'), 1.5)
  assert.equal(parseNumber('1.234.567', 'de'), 1234567)
  assert.equal(parseNumber('12,34.5', 'en'), null)
})

test('Anzeige im Feld je Sprache', () => {
  assert.equal(formatNumberInput(38.1, 'de'), '38.1')
  assert.equal(formatNumberInput(38.1, 'fr'), '38,1')
  assert.equal(formatNumberInput(38, 'fr', 1), '38,0')
  assert.equal(formatNumberInput(-0.5, 'fr'), '−0,5')
  assert.equal(formatNumberInput(1234.5, 'en'), '1234.5')
  assert.equal(formatNumberInput(null, 'de'), '')
  assert.equal(formatNumberInput(NaN, 'de'), '')
  assert.equal(initialNumber('36,8', 'de'), 36.8)
  assert.equal(initialNumber(4, 'de'), 4)
  assert.equal(initialNumber('', 'de'), null)
  assert.equal(initialNumber('x', 'de'), null)
})

test('Grenzen, Raster und Plausibilität', () => {
  assert.deepEqual(checkNumber('5', 'de', { min: 1, max: 8 }), { kind: 'ok', value: 5 })
  assert.deepEqual(checkNumber('0', 'de', { min: 1 }), { kind: 'min', value: 0 })
  assert.deepEqual(checkNumber('9', 'de', { max: 8 }), { kind: 'max', value: 9 })
  assert.deepEqual(checkNumber('1,5', 'de', { step: 1 }), { kind: 'step', value: 1.5 })
  assert.deepEqual(checkNumber('1,5', 'de', { step: 0.5 }), { kind: 'ok', value: 1.5 })
  assert.deepEqual(checkNumber('0.3', 'de', { step: 0.1 }), { kind: 'ok', value: 0.3 })
  assert.deepEqual(checkNumber('1.5', 'de', { step: 'any' }), { kind: 'ok', value: 1.5 })
  assert.deepEqual(checkNumber('x', 'de'), { kind: 'invalid' })
  assert.deepEqual(checkNumber('', 'de', { min: 1 }), { kind: 'ok', value: '' })
  assert.equal(plausibility(39.5, { lo: 35.5, hi: 38 }), 'high')
  assert.equal(plausibility(34, { lo: 35.5, hi: 38 }), 'low')
  assert.equal(plausibility(37, { lo: 35.5, hi: 38 }), null)
  assert.equal(plausibility('', { lo: 1 }), null)
  assert.equal(stepNumber(36.8, 1, { step: 0.1 }), 36.9)
  assert.equal(stepNumber(1, -1, { min: 1 }), 1)
  assert.equal(stepNumber('', 1, { min: 0, step: 5 }), 0)
  assert.equal(stepNumber(8, 1, { max: 8 }), 8)
})

const PEOPLE = [
  { value: '1', label: 'Bühler, Sandra', hint: 'Fachverantwortung', group: 'WG 1' },
  { value: '2', label: 'Muster, Anna', hint: 'Pflege', group: 'WG 1', keywords: 'AM' },
  { value: '3', label: 'Andermatt, Zoé', hint: 'Zimmer 12', group: 'WG 2' },
  { value: '4', label: 'Nguyen, Tim', hint: 'Pflege', group: 'WG 2', disabled: true },
  { value: '5', label: 'Steiner, David', hint: 'Fachverantwortung', group: 'WG 1' },
]

test('Combobox-Filter: Akzente, mehrere Wörter, Reihenfolge', () => {
  assert.equal(normalize('  Bühler Zoé Strasse '), 'buhler zoe strasse')
  assert.equal(filterOptions(PEOPLE, '').length, 5)
  assert.deepEqual(filterOptions(PEOPLE, 'buhler').map((o) => o.value), ['1'])
  assert.deepEqual(filterOptions(PEOPLE, 'ZOE').map((o) => o.value), ['3'])
  assert.deepEqual(filterOptions(PEOPLE, 'pflege').map((o) => o.value), ['2', '4'])
  assert.deepEqual(filterOptions(PEOPLE, 'anna pflege').map((o) => o.value), ['2'])
  assert.deepEqual(filterOptions(PEOPLE, 'st').map((o) => o.value), ['5', '2'], 'Labelanfang vor Teilwort')
  assert.deepEqual(filterOptions(PEOPLE, 'am').map((o) => o.value), ['2'], 'Stichwort')
  assert.deepEqual(filterOptions(PEOPLE, 'an').map((o) => o.value), ['3', '2', '1', '5'], 'Wortanfang vor Teilwort')
  assert.deepEqual(filterOptions(PEOPLE, 'zimmer 12').map((o) => o.value), ['3'])
  assert.deepEqual(filterOptions(PEOPLE, 'xyz'), [])
  assert.deepEqual(filterOptions(PEOPLE, 'a.b(').map((o) => o.value), [], 'Sonderzeichen ohne Fehler')
})

test('Combobox: Gruppen und Tastaturnavigation', () => {
  const g = groupOptions(PEOPLE)
  assert.deepEqual(g.map((x) => [x.group, x.items.map((o) => o.value)]), [['WG 1', ['1', '2', '5']], ['WG 2', ['3', '4']]])
  assert.equal(nextEnabled(PEOPLE, 2, 1), 4, 'deaktivierte Option wird übersprungen')
  assert.equal(nextEnabled(PEOPLE, 4, 1), 0, 'Umlauf')
  assert.equal(nextEnabled(PEOPLE, 0, -1), 4)
  assert.equal(nextEnabled(PEOPLE, -1, 1), 0)
  assert.equal(nextEnabled([], 0, 1), -1)
  assert.equal(nextEnabled([{ value: 'x', label: 'x', disabled: true }], 0, 1), -1)
})
