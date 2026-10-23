import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeT } from '../i18n/core'
import { dictionary } from '../i18n'
import { dedupeTaskHits, normText, systemTaskMatches } from './task-search'
import { taskTitle } from './task-title'

const de = makeT(dictionary('de'), 'de', 'resident')
const fr = makeT(dictionary('fr'), 'fr', 'resident')

test('Suche: «Medikament» findet Medikamenten-Zeitpunkte über den übersetzten Titel', () => {
  const m = systemTaskMatches(de, 'Medikament')
  assert.ok(m.titles.includes('medication.slot'))
  // Kategorie «Medikation» trifft «Medika», nicht «Medikament»
  assert.ok(systemTaskMatches(de, 'medika').categories.includes('Medikation'))
  assert.ok(systemTaskMatches(fr, 'médic').titles.includes('medication.slot'))
})

test('Suche: Instrumente, Regeln und Ereignisschritte über ihren Namen', () => {
  assert.ok(systemTaskMatches(de, 'braden').titles.includes('assessment.braden'))
  assert.ok(systemTaskMatches(de, 'lagerungsplan').titles.includes('rule.bradenRisk'))
  assert.ok(systemTaskMatches(de, 'Hausarzt').titles.includes('incident.physician'))
  assert.ok(systemTaskMatches(de, 'Verordnung anpassen').titles.includes('visit.order.medication'))
  // allgemeiner Teil trifft alle Assessments
  assert.deepEqual(systemTaskMatches(de, 'Assessment fällig').prefixes, ['assessment.'])
  // zu kurz → nichts
  assert.deepEqual(systemTaskMatches(de, 'm'), { titles: [], prefixes: [], categories: [] })
})

test('Suche: Treffer zeigen nie rohe Schlüssel und werden je Person gebündelt', () => {
  const at = new Date('2026-10-23T08:00:00')
  const rows = ['medication.slot', 'medication.slot', 'rule.bradenRisk', 'assessment.braden'].map((title, i) => ({ residentId: i < 2 ? 'r1' : 'r2', title, dueAt: at }))
  const hits = dedupeTaskHits(rows.map((r) => ({ ...r, label: taskTitle(de, r) })), 6)
  assert.equal(hits.length, 3)
  assert.equal(hits[0].n, 2)
  for (const h of hits) assert.doesNotMatch(h.row.label, /^(medication|rule|assessment)\./)
  assert.equal(normText('Médicaments'), 'medicaments')
})
