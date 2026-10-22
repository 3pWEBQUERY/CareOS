import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customFlag, customKey, customVitals, normalizeCustom, parseCustom, readExtra } from './vitals-custom'

test('Eigene Vitalparameter: Definition prüfen', () => {
  const r = normalizeCustom([{ label: 'Bauchumfang', unit: 'cm', min: '40', max: '200', dec: 0 }, { label: 'Peak-Flow', unit: 'l/min', min: 50, max: 900, lo: 300 }])
  assert.ok(r.ok)
  if (r.ok) { assert.equal(r.defs[0].key, 'bauchumfang'); assert.equal(r.defs[1].key, 'peak_flow'); assert.equal(r.defs[1].lo, 300) }
  assert.equal(normalizeCustom([{ label: 'Puls', key: 'pulse', min: 1, max: 2 }]).ok, false)
  assert.equal(normalizeCustom([{ label: 'X', min: 5, max: 5 }]).ok, false)
  assert.equal(normalizeCustom([{ label: 'X', min: 0, max: 10, lo: 8, hi: 4 }]).ok, false)
  assert.equal(customKey('Ödeme 1. Grad'), 'oedeme_1_grad')
  assert.deepEqual(customVitals({ customVitals: 'kaputt' }), [])
})

test('Eigene Vitalparameter: Werte, Plausibilität, Markierung', () => {
  const defs = customVitals({ customVitals: [{ label: 'Peak-Flow', unit: 'l/min', min: 50, max: 900, lo: 300 }] })
  const form: Record<string, string> = { x_peak_flow: '280' }
  const ok = parseCustom((n) => form[n] ?? '', defs)
  assert.deepEqual(ok, { values: { peak_flow: 280 } })
  assert.equal(customFlag(defs[0], 280), 'lo')
  const bad = parseCustom((n) => (n === 'x_peak_flow' ? '2000' : ''), defs)
  assert.ok('error' in bad)
  assert.deepEqual(readExtra({ peak_flow: 280, x: 'a' }), { peak_flow: 280 })
})
