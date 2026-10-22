import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AssessmentDraft, rangeProblem, scoreBounds, toItems } from './assessment-builder'
import { scoreAssessment } from './clinical-config'

// BESD (Beurteilung von Schmerzen bei Demenz): 5 Merkmale à 0–2 Punkte
const q = (label: string) => ({ label, options: [{ label: 'nein', v: 0 }, { label: 'teilweise', v: 1 }, { label: 'ausgeprägt', v: 2 }] })
const besd = {
  name: 'BESD', description: 'Schmerz bei Demenz', intervalDays: '7',
  questions: ['Atmung', 'Negative Lautäusserung', 'Gesichtsausdruck', 'Körpersprache', 'Trost'].map(q),
  ranges: [
    { min: 0, max: 1, result: 'kein Hinweis auf Schmerz', level: 'ok' },
    { min: 2, max: 4, result: 'Schmerz wahrscheinlich', level: 'warn' },
    { min: 5, max: 10, result: 'starker Schmerz wahrscheinlich', level: 'crit' },
  ],
}

test('Punktbereich und Bewertungsbereiche', () => {
  const d = AssessmentDraft.parse(besd)
  assert.deepEqual(scoreBounds(d.questions), { min: 0, max: 10 })
  assert.equal(rangeProblem(d.questions, d.ranges), null)
  assert.equal(rangeProblem(d.questions, [{ min: 0, max: 4 }, { min: 6, max: 10 }]), 'forms.assessment.errors.rangeGap')
  assert.equal(rangeProblem(d.questions, [{ min: 0, max: 5 }, { min: 5, max: 10 }]), 'forms.assessment.errors.rangeOverlap')
  assert.equal(rangeProblem(d.questions, [{ min: 0, max: 9 }]), 'forms.assessment.errors.rangeCoverage')
  assert.equal(rangeProblem(d.questions, [{ min: 3, max: 1 }]), 'forms.assessment.errors.rangeOrder')
})

test('Gespeicherte Form wird wie die Standardinstrumente ausgewertet', () => {
  const d = AssessmentDraft.parse(besd)
  const items = toItems(d)
  assert.deepEqual(items.questions.map((x) => x.key), ['q1', 'q2', 'q3', 'q4', 'q5'])
  const r = scoreAssessment({ key: 'besd', name: 'BESD', description: '', intervalDays: 7, items }, { q1: 1, q2: 2, q3: 1, q4: 0, q5: 0 })
  assert.deepEqual(r, { score: 4, result: 'Schmerz wahrscheinlich', level: 'warn' })
})

test('Validierung: Fehler als i18n-Schlüssel', () => {
  const one = AssessmentDraft.safeParse({ ...besd, questions: [{ label: 'x', options: [{ label: 'a', v: 0 }] }] })
  assert.equal(one.error?.issues[0].message, 'forms.assessment.errors.options')
  const iv = AssessmentDraft.safeParse({ ...besd, intervalDays: '0' })
  assert.equal(iv.error?.issues[0].message, 'forms.assessment.errors.interval')
  assert.equal(AssessmentDraft.parse({ ...besd, intervalDays: '' }).intervalDays, null)
})
