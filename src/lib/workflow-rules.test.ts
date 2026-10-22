import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayTimeDue, DEFAULT_WORKFLOWS, periodIndex, ruleDue, weightChange, woundProgress, workflowPolicy } from './workflow-rules'

const at = (d: number, h = 8, m = 0) => new Date(2026, 9, d, h, m)

test('Konfiguration: Standardwerte, Grenzen, ungültige Werte', () => {
  assert.deepEqual(workflowPolicy({}), DEFAULT_WORKFLOWS)
  assert.deepEqual(workflowPolicy(null), DEFAULT_WORKFLOWS)
  const p = workflowPolicy({ workflows: { vitalsRecheck: { enabled: false, afterMin: 5 }, weightLoss: { pct: '7', days: 999 }, bradenRisk: { maxScore: 'x' } } })
  assert.equal(p.vitalsRecheck.enabled, false)
  assert.equal(p.vitalsRecheck.afterMin, 15)
  assert.equal(p.weightLoss.pct, 7)
  assert.equal(p.weightLoss.days, 180)
  assert.equal(p.bradenRisk.maxScore, 12)
  assert.equal(p.woundStalled.enabled, true)
})

test('Gewichtsverlust: frühester gegen letzten Wert im Fenster', () => {
  const pts = [{ at: at(1), weight: 70 }, { at: at(10), weight: 68 }, { at: at(20), weight: 66.2 }]
  const c = weightChange(pts, 30, at(22))!
  assert.equal(c.from, 70)
  assert.equal(c.to, 66.2)
  assert.ok(Math.abs(c.pct - -5.43) < 0.01)
  // Wert ausserhalb des Fensters zählt nicht
  assert.equal(weightChange(pts, 15, at(22))!.from, 68)
  // Tagesschwankung (< 3 Tage Abstand) und Einzelwert ergeben keinen Befund
  assert.equal(weightChange([{ at: at(20), weight: 70 }, { at: at(21), weight: 66 }], 30, at(22)), null)
  assert.equal(weightChange([{ at: at(20), weight: 70 }], 30, at(22)), null)
})

test('Wunde: stagniert, wenn die Fläche nach 14 Tagen nicht um 20 % kleiner ist', () => {
  const e = (d: number, l: number | null, w: number | null) => ({ at: at(d), lengthMm: l, widthMm: w })
  assert.equal(woundProgress([e(1, 30, 20), e(15, 29, 20)], 14, 20)!.stalled, true)
  assert.equal(woundProgress([e(1, 30, 20), e(15, 24, 20)], 14, 20)!.stalled, false)
  // Referenz ist die letzte Messung, die mindestens 14 Tage zurückliegt
  const r = woundProgress([e(1, 40, 20), e(3, 30, 20), e(17, 30, 19)], 14, 20)!
  assert.equal(r.refArea, 600)
  assert.equal(r.stalled, true)
  // zu kurzer Verlauf oder fehlende Masse: kein Befund
  assert.equal(woundProgress([e(1, 30, 20), e(10, 30, 20)], 14, 20), null)
  assert.equal(woundProgress([e(1, null, 20), e(20, 30, 20)], 14, 20), null)
})

test('Fälligkeit: nach dem Auslöser, nie in der Vergangenheit, Tagschicht für nicht dringende Regeln', () => {
  assert.deepEqual(ruleDue(at(22, 9, 2), 60, at(22, 9, 5)), at(22, 10, 5))
  assert.deepEqual(ruleDue(at(22, 6, 0), 60, at(22, 9, 3)), at(22, 9, 5))
  assert.deepEqual(dayTimeDue(at(22, 3, 0)), at(22, 10, 0))
  assert.deepEqual(dayTimeDue(at(22, 11, 12)), at(22, 12, 15))
  assert.deepEqual(dayTimeDue(at(22, 19, 30)), at(23, 10, 0))
})

test('Wunde löst höchstens einmal je Zeitraum aus', () => {
  assert.equal(periodIndex(at(1), at(14, 7), 14), 0)
  assert.equal(periodIndex(at(1), at(16), 14), 1)
})
