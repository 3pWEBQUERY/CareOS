import { test } from 'node:test'
import assert from 'node:assert/strict'
import { physicianTextMatches } from './text-match'

const keller = { firstName: 'Peter', lastName: 'Keller' }

test('Hausarzt-Freitext: Nachname mit passender Initiale oder Vorname', () => {
  assert.equal(physicianTextMatches('Dr. med. P. Keller', keller), true)
  assert.equal(physicianTextMatches('Keller', keller), true)
  assert.equal(physicianTextMatches('Dr. Peter Keller, FMH', keller), true)
  assert.equal(physicianTextMatches('Dr. med. A. Keller', keller), false)
  assert.equal(physicianTextMatches('Dr. med. A. Rüegg', keller), false)
  assert.equal(physicianTextMatches('Kellerhals', keller), false)
  assert.equal(physicianTextMatches(null, keller), false)
})

test('Hausarzt-Freitext: Akzente und Doppelnamen', () => {
  assert.equal(physicianTextMatches('Dr. A. Rüegg', { firstName: 'Anna', lastName: 'Ruegg' }), true)
  assert.equal(physicianTextMatches('Dr. med. M.-L. Meier Brunner', { firstName: 'Marie-Louise', lastName: 'Meier Brunner' }), true)
})
