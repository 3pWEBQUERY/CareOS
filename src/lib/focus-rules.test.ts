import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FOCUS_RULES, FALL_RE, focusRules, pendingFocus } from './focus-rules'

const now = new Date(2026, 9, 22, 14, 0)
const h = (x: number) => new Date(now.getTime() - x * 3600_000)
const forms = ['schmerzerfassung', 'sturzprotokoll']
const base = { rules: DEFAULT_FOCUS_RULES, vitals: [], notes: [], tasks: [], forms, now }

test('Fokus: Schmerz NRS ≥ 4 schlägt Schmerzerfassung mit Vorbelegung vor', () => {
  const s = pendingFocus({ ...base, vitals: [{ id: 'v1', at: h(2), pain: 6, abnormal: ['pain'] }] })
  assert.equal(s.length, 1)
  assert.equal(s[0].rule, 'pain')
  assert.equal(s[0].formKey, 'schmerzerfassung')
  assert.deepEqual(s[0].prefill, { nrs: '6' })
})

test('Fokus: erledigt, sobald das Formular nach der Messung vorliegt; ausserhalb des Fensters kein Vorschlag', () => {
  const v = { id: 'v1', at: h(2), pain: 6, abnormal: ['pain'] }
  assert.equal(pendingFocus({ ...base, vitals: [v], notes: [{ id: 'n', at: h(1), text: '', formKey: 'schmerzerfassung', source: 'manual', taskId: null }] }).length, 0)
  assert.equal(pendingFocus({ ...base, vitals: [{ ...v, at: h(13) }] }).length, 0)
  assert.equal(pendingFocus({ ...base, vitals: [{ ...v, pain: 3 }] }).length, 0)
})

test('Fokus: auffälliger Vitalwert → Verlaufseintrag; freier Eintrag danach erledigt ihn', () => {
  const v = { id: 'v2', at: h(1), pain: null, abnormal: ['temp', 'spo2'] }
  const s = pendingFocus({ ...base, vitals: [v] })
  assert.equal(s[0].rule, 'vitalAbnormal')
  assert.equal(s[0].formKey, null)
  assert.equal(s[0].vars.n, 2)
  assert.equal(pendingFocus({ ...base, vitals: [v], notes: [{ id: 'n', at: h(0.5), text: 'Fieber, Arzt informiert', formKey: null, source: 'manual', taskId: null }] }).length, 0)
  // Quittierte Aufgaben zählen nicht als Beobachtung
  assert.equal(pendingFocus({ ...base, vitals: [v], notes: [{ id: 'n', at: h(0.5), text: 'Lagerung: erledigt.', formKey: null, source: 'task', taskId: 't' }] }).length, 1)
})

test('Fokus: Sturz im Verlauf → Sturzprotokoll (mehrsprachig, ohne «Fall»)', () => {
  assert.ok(FALL_RE.test('Bewohnerin um 03:10 am Boden aufgefunden'))
  assert.ok(FALL_RE.test('Sturz im Bad, keine Verletzung'))
  assert.ok(FALL_RE.test('Chute dans la chambre'))
  assert.ok(FALL_RE.test('caduta in bagno'))
  assert.ok(!FALL_RE.test('In diesem Fall Arzt informieren'))
  assert.ok(!FALL_RE.test('Das Essen hat ihr gefallen'))
  const s = pendingFocus({ ...base, notes: [{ id: 'n1', at: h(3), text: 'Gestürzt beim Aufstehen', formKey: null, source: 'manual', taskId: null }] })
  assert.equal(s[0].rule, 'fall')
  assert.equal(pendingFocus({ ...base, forms: [], notes: [{ id: 'n1', at: h(3), text: 'Sturz', formKey: null, source: 'manual', taskId: null }] }).length, 0)
})

test('Fokus: wiederholt nicht durchgeführte Massnahme', () => {
  const t = (id: string, x: number) => ({ id, title: 'Mobilisation', status: 'skipped', completedAt: h(x) })
  assert.equal(pendingFocus({ ...base, tasks: [t('a', 30)] }).length, 0)
  const s = pendingFocus({ ...base, tasks: [t('a', 30), t('b', 5)] })
  assert.equal(s[0].rule, 'taskSkipped')
  assert.equal(s[0].id, 'skip:b')
  assert.equal(s[0].vars.n, 2)
})

test('Fokus: Einstellungen überschreiben Standard, ungültige Werte werden ignoriert', () => {
  const r = focusRules({ focusDocumentation: { pain: { threshold: 6, windowH: 1000 }, fall: { enabled: false }, vitalAbnormal: { formKey: 'vitalprotokoll' } } })
  assert.equal(r.find((x) => x.key === 'pain')!.threshold, 6)
  assert.equal(r.find((x) => x.key === 'pain')!.windowH, 12)
  assert.equal(r.find((x) => x.key === 'fall')!.enabled, false)
  assert.equal(r.find((x) => x.key === 'vitalAbnormal')!.formKey, 'vitalprotokoll')
  assert.deepEqual(focusRules(null), DEFAULT_FOCUS_RULES)
})
