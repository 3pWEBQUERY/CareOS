import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkInteractions, providerFor, registerInteractionAdapter, type DrugRef } from './integrations/drug-interactions'
import { drugList, gate, reasonOk } from './interaction-gate'

// Fake-Adapter: prüft ausschliesslich über ATC-Codes (wie eine echte Datenquelle), Namen sind nur Anzeige.
const PAIRS: Record<string, 'contraindicated' | 'major' | 'moderate'> = {
  'B01AA04|M01AE01': 'major', // Phenprocoumon + Ibuprofen: Blutungsrisiko
  'C03DA01|C09AA05': 'moderate', // Spironolacton + Ramipril: Hyperkaliämie
  'G04BE03|C01DA02': 'contraindicated', // Sildenafil + Nitroglycerin
}
const seen: DrugRef[][] = []
registerInteractionAdapter('fake-atc', () => ({
  id: 'fake-atc', name: 'Testquelle',
  async check(drugs) {
    seen.push(drugs)
    const out = []
    for (let i = 0; i < drugs.length; i++) for (let j = i + 1; j < drugs.length; j++) {
      const a = drugs[i], b = drugs[j]
      const sev = PAIRS[`${a.atc}|${b.atc}`] ?? PAIRS[`${b.atc}|${a.atc}`]
      if (sev) out.push({ drugs: [a.name, b.name] as [string, string], severity: sev, text: 'Testhinweis' })
    }
    return { status: 'checked' as const, source: 'Testquelle', checkedAt: '', interactions: out }
  },
}))
const provider = providerFor({ name: 'Testquelle', active: true, config: { provider: 'fake-atc' } })
const active = [
  { id: 'm1', name: 'Marcoumar 3 mg', atc: 'B01AA04', gtin: null },
  { id: 'm2', name: 'Ramipril 5 mg', atc: 'C09AA05', gtin: null },
]

test('Interaktion im Dialog: Prüfung über ATC-Codes, ersetzte Verordnung ausgenommen', async () => {
  const draft = { name: 'Brufen 400', atc: 'M01AE01', gtin: null }
  const list = drugList(draft, active, null)
  const g = gate(await checkInteractions(provider, list, 'de'), draft.name)
  assert.equal(g.level, 'major')
  assert.equal(g.needsReason, false)
  assert.equal(seen.at(-1)?.[0].atc, 'M01AE01')
  // Änderung von Marcoumar: die alte Verordnung zählt nicht mit
  const g2 = gate(await checkInteractions(provider, drugList({ name: 'Marcoumar 1.5 mg', atc: 'B01AA04' }, active, 'm1'), 'de'), 'Marcoumar 1.5 mg')
  assert.equal(g2.level, 'clear')
})

test('Interaktion im Dialog: kontraindiziert nur mit Begründung', async () => {
  const draft = { name: 'Nitroderm TTS', atc: 'C01DA02' }
  const g = gate(await checkInteractions(provider, drugList(draft, [...active, { id: 'm3', name: 'Viagra 50', atc: 'G04BE03', gtin: null }], null), 'de'), draft.name)
  assert.equal(g.level, 'contraindicated')
  assert.equal(reasonOk(g, ''), false)
  assert.equal(reasonOk(g, 'Rücksprache Kardiologie, Sildenafil pausiert'), true)
})

test('Interaktion im Dialog: Treffer ohne das neue Medikament zählen nicht', async () => {
  const meds = [...active, { id: 'm4', name: 'Aldactone', atc: 'C03DA01', gtin: null }]
  const g = gate(await checkInteractions(provider, drugList({ name: 'Dafalgan', atc: 'N02BE01' }, meds, null), 'de'), 'Dafalgan')
  assert.equal(g.level, 'clear')
  assert.equal(g.hits.length, 0)
})

test('Interaktion im Dialog: ohne Datenquelle «nicht geprüft», blockiert nicht', async () => {
  const g = gate(await checkInteractions(providerFor(null), drugList({ name: 'Brufen', atc: 'M01AE01' }, active, null), 'de'), 'Brufen')
  assert.equal(g.level, 'unavailable')
  assert.equal(g.reason, 'not_configured')
  assert.equal(reasonOk(g, ''), true)
})
