import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkInteractions, providerFor, registerInteractionAdapter } from './drug-interactions'

const drugs = [{ name: 'Marcoumar' }, { name: 'Aspirin Cardio' }]

test('Interaktionen: ohne Integration nie Entwarnung', async () => {
  const r = await checkInteractions(providerFor(null), drugs, 'de')
  assert.equal(r.status, 'unavailable')
  assert.equal(r.status === 'unavailable' && r.reason, 'not_configured')
})

test('Interaktionen: Integration ohne Adapter = nicht ausführbar', async () => {
  const r = await checkInteractions(providerFor({ name: 'Documedis', active: true, config: { provider: 'documedis' } }), drugs, 'de')
  assert.equal(r.status === 'unavailable' && r.reason, 'no_adapter')
  assert.equal(r.status === 'unavailable' && r.source, 'Documedis')
})

test('Interaktionen: Adapterfehler wird als nicht verfügbar gemeldet', async () => {
  registerInteractionAdapter('test-fail', () => ({ id: 'test-fail', name: 'Test', check: async () => { throw new Error('down') } }))
  const r = await checkInteractions(providerFor({ name: 'Test', active: true, config: { provider: 'test-fail' } }), drugs, 'de')
  assert.equal(r.status === 'unavailable' && r.reason, 'error')
})

test('Interaktionen: Adapter liefert Treffer', async () => {
  registerInteractionAdapter('test-ok', () => ({
    id: 'test-ok', name: 'Test', check: async (d) => ({ status: 'checked', source: 'Test', checkedAt: '', interactions: [{ drugs: [d[0].name, d[1].name], severity: 'major', text: 'Blutungsrisiko' }] }),
  }))
  const r = await checkInteractions(providerFor({ name: 'Test', active: true, config: { provider: 'test-ok' } }), drugs, 'de')
  assert.equal(r.status, 'checked')
  assert.equal(r.status === 'checked' && r.interactions[0].severity, 'major')
})
