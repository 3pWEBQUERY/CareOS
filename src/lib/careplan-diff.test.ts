import { test } from 'node:test'
import assert from 'node:assert/strict'
import { careplanChanges, hasChanges, type AreaLike } from './careplan-diff'

const iv = (title: string, times = ['08:00']) => ({ title, category: 'care', times, weekdays: [], instructions: null })
const area = (domain: string, o: Partial<AreaLike> = {}): AreaLike => ({
  domain, situation: null, resources: null, needs: null, risks: null, goal: null, evaluation: null, evaluateBy: null, interventions: [], ...o,
})

test('Freigabeliste: Erstfassung ohne aktive Version', () => {
  const c = careplanChanges(null, [area('mobility', { interventions: [iv('Mobilisation')] })])
  assert.equal(c.first, true)
  assert.deepEqual(c.areasAdded, ['mobility'])
  assert.deepEqual(c.ivs.added, ['Mobilisation'])
  assert.equal(hasChanges(c), true)
})

test('Freigabeliste: Bereiche neu, entfernt, geändert (Text, Evaluation, Massnahmen)', () => {
  const prev = [
    area('mobility', { goal: 'Gehfähigkeit erhalten', interventions: [iv('Mobilisation')] }),
    area('skin', { interventions: [iv('Lagerung', ['08:00', '12:00'])] }),
    area('sleep'),
    area('pain', { evaluateBy: new Date('2026-11-01T00:00:00Z') }),
  ]
  const next = [
    area('mobility', { goal: '  Gehfähigkeit   erhalten ', interventions: [iv('Mobilisation')] }), // nur Leerraum: unverändert
    area('skin', { interventions: [iv('Lagerung', ['08:00', '12:00', '16:00'])] }),
    area('pain', { evaluateBy: new Date('2026-11-15T00:00:00Z') }),
    area('nutrition', { interventions: [iv('Trinkprotokoll')] }),
  ]
  const c = careplanChanges(prev, next)
  assert.equal(c.first, false)
  assert.deepEqual(c.areasAdded, ['nutrition'])
  assert.deepEqual(c.areasRemoved, ['sleep'])
  assert.deepEqual(c.areasChanged, ['skin', 'pain'])
  assert.deepEqual(c.ivs, { added: ['Trinkprotokoll'], removed: [], changed: ['Lagerung'] })
})

test('Freigabeliste: Entwurf identisch mit aktiver Version', () => {
  const a = [area('mobility', { goal: 'x', interventions: [iv('Mobilisation')] })]
  assert.equal(hasChanges(careplanChanges(a, a)), false)
})
