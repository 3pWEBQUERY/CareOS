import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h, Fragment } from 'react'
import { firstEnabled, groupRuns, lastEnabled, moveActive, optionsFromChildren, resolveValue, selectKeyAction, textOf, typeahead, type SelectOpt } from './select-options'

const opt = (value: string | number | undefined, text: unknown, extra: Record<string, unknown> = {}) => h('option', { key: String(value ?? text), value, ...extra }, text as string)

test('Optionen aus <option>/<optgroup>, Fragmenten, Arrays und gemischtem Text', () => {
  const kids = [
    opt('', 'Bitte wählen', { disabled: true }),
    false,
    null,
    h(Fragment, { key: 'f' }, opt('a', ['Haus A', ' · ', 'WG 1']), opt(undefined, 'Ohne Wert')),
    h('optgroup', { key: 'g1', label: 'Standorte' }, [opt('loc:1', 'Lindenhof'), opt('loc:2', 'Seeblick', { disabled: true })]),
    h('optgroup', { key: 'g2', label: 'Gesperrt', disabled: true }, opt('x', 'X')),
    opt(3, 'Zahl'),
  ]
  assert.deepEqual(optionsFromChildren(kids), [
    { value: '', label: 'Bitte wählen', disabled: true, placeholder: true },
    { value: 'a', label: 'Haus A · WG 1' },
    { value: 'Ohne Wert', label: 'Ohne Wert' },
    { value: 'loc:1', label: 'Lindenhof', group: 'Standorte' },
    { value: 'loc:2', label: 'Seeblick', disabled: true, group: 'Standorte' },
    { value: 'x', label: 'X', disabled: true, group: 'Gesperrt' },
    { value: '3', label: 'Zahl' },
  ])
  assert.deepEqual(optionsFromChildren(opt('w', 'Wert'), 'Alle'), [{ value: '', label: 'Alle', placeholder: true }, { value: 'w', label: 'Wert' }])
  assert.equal(textOf(['a', 1, null, h('b', null, 'c')]), 'a1c')
})

const O: SelectOpt[] = [
  { value: '', label: 'Bitte wählen', disabled: true, placeholder: true },
  { value: 'm1', label: 'Meier' },
  { value: 'k', label: 'Keller', disabled: true },
  { value: 'm2', label: 'Müller' },
  { value: 'b', label: 'Brunner' },
  { value: 'm3', label: 'Marti' },
]

test('Wert wie beim nativen <select>: Treffer (auch deaktiviert), sonst erste aktivierbare Option', () => {
  assert.equal(resolveValue(O, ''), '')
  assert.equal(resolveValue(O, 'b'), 'b')
  assert.equal(resolveValue(O, 'k'), 'k')
  assert.equal(resolveValue(O, 'weg'), 'm1')
  assert.equal(resolveValue(O, undefined), 'm1')
  assert.equal(resolveValue([], 'x'), '')
  assert.equal(resolveValue([{ value: 'a', label: 'A', disabled: true }], undefined), 'a')
})

test('Pfeile, Bild auf/ab, Pos1/Ende überspringen deaktivierte Optionen ohne Umlauf', () => {
  assert.equal(firstEnabled(O), 1)
  assert.equal(lastEnabled(O), 5)
  assert.equal(moveActive(O, 1, 1), 3) // über «Keller» (deaktiviert)
  assert.equal(moveActive(O, 3, -1), 1)
  assert.equal(moveActive(O, 1, -1), 1) // oben bleibt, Platzhalter ist deaktiviert
  assert.equal(moveActive(O, 5, 1), 5) // kein Umlauf
  assert.equal(moveActive(O, 1, 10), 5)
  assert.equal(moveActive(O, 5, -10), 1)
  assert.equal(moveActive(O, 0, -1), 1) // aktiv auf deaktiviertem Platzhalter
  assert.equal(moveActive(O, -1, 1), 1)
  assert.equal(moveActive(O, -1, -1), 5)
  assert.equal(moveActive([], 0, 1), -1)
})

test('Tippen springt zum Treffer (ohne Akzente), Wiederholung wechselt zwischen Treffern', () => {
  assert.equal(typeahead(O, 1, 'b'), 4)
  assert.equal(typeahead(O, -1, 'm'), 1)
  assert.equal(typeahead(O, 1, 'm'), 3) // nächster Treffer nach der aktiven Option
  assert.equal(typeahead(O, 3, 'mm'), 5) // «mm» = erneut «m»
  assert.equal(typeahead(O, 5, 'mmm'), 1) // Umlauf
  assert.equal(typeahead(O, 1, 'mu'), 3) // «Müller» ohne Umlaut
  assert.equal(typeahead(O, 3, 'mue'), -1)
  assert.equal(typeahead(O, 1, 'me'), 1) // aktuelle Option passt weiter
  assert.equal(typeahead(O, 1, 'k'), -1) // deaktiviert
  assert.equal(typeahead(O, 1, ''), -1)
})

test('Tasten nach WAI-ARIA «Select-only Combobox»', () => {
  const k = (key: string, more: Record<string, boolean> = {}) => ({ key, ...more })
  // geschlossen
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) assert.equal(selectKeyAction(k(key), false), 'open')
  assert.equal(selectKeyAction(k('Home'), false), 'first')
  assert.equal(selectKeyAction(k('End'), false), 'last')
  assert.equal(selectKeyAction(k('m'), false), 'type')
  assert.equal(selectKeyAction(k('Escape'), false), null) // Dialog darf schliessen
  assert.equal(selectKeyAction(k('Tab'), false), null)
  assert.equal(selectKeyAction(k('c', { ctrlKey: true }), false), null)
  // offen
  assert.equal(selectKeyAction(k('ArrowDown'), true), 'next')
  assert.equal(selectKeyAction(k('ArrowUp'), true), 'prev')
  assert.equal(selectKeyAction(k('ArrowUp', { altKey: true }), true), 'select')
  assert.equal(selectKeyAction(k('PageDown'), true), 'pageNext')
  assert.equal(selectKeyAction(k('PageUp'), true), 'pagePrev')
  assert.equal(selectKeyAction(k('Home'), true), 'first')
  assert.equal(selectKeyAction(k('End'), true), 'last')
  assert.equal(selectKeyAction(k('Enter'), true), 'select')
  assert.equal(selectKeyAction(k(' '), true), 'select')
  assert.equal(selectKeyAction(k(' '), true, true), 'type') // Leertaste beim Tippen («Haus A»)
  assert.equal(selectKeyAction(k('Escape'), true), 'close')
  assert.equal(selectKeyAction(k('Tab'), true), 'tab')
  assert.equal(selectKeyAction(k('x'), true), 'type')
  assert.equal(selectKeyAction(k('Shift'), true), null)
})

test('Gruppen in Anzeige-Reihenfolge mit Startindex', () => {
  const g = groupRuns([{ value: '', label: 'Alle' }, { value: 'a', label: 'A', group: 'X' }, { value: 'b', label: 'B', group: 'X' }, { value: 'c', label: 'C', group: 'Y' }])
  assert.deepEqual(g.map((x) => [x.group, x.start, x.items.length]), [[undefined, 0, 1], ['X', 1, 2], ['Y', 3, 1]])
})
