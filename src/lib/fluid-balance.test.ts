import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fluidBalance, signedMl } from './fluid-balance'

const d = (day: number, h: number) => new Date(2026, 9, day, h)

test('Bilanz: Einfuhr aller Wege minus Ausfuhr je Tag', () => {
  const logs = [
    { kind: 'drink', amountMl: 200, at: d(22, 8) },
    { kind: 'drink', amountMl: 150, at: d(22, 10) },
    { kind: 'in_infusion', amountMl: 500, at: d(22, 9) },
    { kind: 'out_urine', amountMl: 400, at: d(22, 7) },
    { kind: 'out_vomit', amountMl: 100, at: d(22, 12) },
    { kind: 'meal', amountMl: null, at: d(22, 12) },
    { kind: 'drink', amountMl: 300, at: d(21, 23) },
  ]
  const [y, t] = fluidBalance(logs, [d(21, 0), d(22, 0)])
  assert.equal(t.inMl, 850)
  assert.equal(t.in.in_infusion, 500)
  assert.equal(t.outMl, 500)
  assert.equal(t.balance, 350)
  assert.equal(t.outEntries, 2)
  // ohne Ausfuhr keine Bilanz
  assert.equal(y.inMl, 300)
  assert.equal(y.balance, null)
})

test('Bilanz: Vorzeichen', () => {
  const f = (n: number) => String(n)
  assert.equal(signedMl(350, f), '+350')
  assert.equal(signedMl(-120, f), '−120')
  assert.equal(signedMl(0, f), '±0')
})
