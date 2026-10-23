import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planStaff } from './generate/people'
import { kindOf, topUpPlan } from './staff-topup'

test('Auffüllen von 15 auf 100 ergänzt 85 Plätze ohne zweite Leitung', () => {
  const existing = planStaff(15, 4)
  const missing = topUpPlan(100, 4, existing)
  assert.equal(missing.length, 85)
  assert.equal(missing.filter((m) => m.kind === 'director' || m.kind === 'lead').length, 0)
  const all = [...existing, ...missing]
  assert.equal(all.filter((m) => m.kind === 'director').length, 1)
  assert.equal(all.filter((m) => m.kind === 'lead').length, 4)
  for (let u = 0; u < 4; u++) assert.ok(all.filter((m) => m.unitIndex === u).length >= 20)
})

test('Bereits erreicht oder überschritten: nichts ergänzen', () => {
  assert.equal(topUpPlan(15, 4, planStaff(15, 4)).length, 0)
  assert.equal(topUpPlan(10, 4, planStaff(15, 4)).length, 0)
})

test('Art aus Rolle und Funktion', () => {
  assert.equal(kindOf(['nurse'], 'Fachfrau Gesundheit EFZ'), 'fage')
  assert.equal(kindOf(['nurse'], 'Pflegefachfrau HF'), 'rn')
  assert.equal(kindOf(['ward_lead', 'nurse'], null), 'lead')
  assert.equal(kindOf(['sysadmin'], 'Systemadministration'), null)
})
