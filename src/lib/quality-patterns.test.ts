import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeT } from '@/i18n/core'
import { dictionary } from '@/i18n'
import { patternHints, placeKind, timeBucket, type PatternIncident } from './quality-patterns'

const t = makeT(dictionary('de'), 'de', 'resident')
const now = new Date(2026, 9, 22, 12, 0)
const day = (d: number, h = 10) => new Date(2026, 9, d, h, 0)
const meier = { id: 'r1', firstName: 'Anna', lastName: 'Meier' }
const keller = { id: 'r2', firstName: 'Paul', lastName: 'Keller' }
const inc = (at: Date, type = 'fall', resident: PatternIncident['resident'] = meier, place: string | null = null, nearMiss = false): PatternIncident => ({
  occurredAt: at, place, severity: 'minor', nearMiss, residentId: resident?.id ?? null, type: { key: type, name: type === 'fall' ? 'Sturz' : type === 'aggression' ? 'Aggressionsereignis' : 'Medikationsereignis', id: 'it-' + type }, resident,
})
const keys = (h: { key: string }[]) => h.map((x) => x.key).sort()

test('Tageszeit und Ort aus Freitext', () => {
  assert.equal(timeBucket(day(1, 23)), 'night')
  assert.equal(timeBucket(day(1, 7)), 'morning')
  assert.equal(placeKind('Badezimmer Zi. 207'), 'bathroom')
  assert.equal(placeKind('neben dem Bett'), 'room')
  assert.equal(placeKind(''), 'unknown')
})

test('Wiederholte Stürze: Hinweis, Link auf die Ereignisse und fehlende Neueinschätzung', () => {
  const rows = [inc(day(10)), inc(day(18))]
  const h = patternHints(t, rows, now)
  assert.deepEqual(keys(h), ['fallRiskStale:r1', 'repeatFalls:r1'])
  assert.match(h.find((x) => x.key === 'repeatFalls:r1')!.text, /^Meier Anna: 2 Stürze/)
  assert.equal(h.find((x) => x.key === 'repeatFalls:r1')!.href, '/quality?resident=r1&period=90')
  // Sturzrisiko nach dem ersten Sturz neu eingeschätzt → kein Hinweis
  assert.deepEqual(keys(patternHints(t, rows, now, () => true, 'de-CH', new Map([['r1', day(11)]]))), ['repeatFalls:r1'])
  // Beinahe-Stürze zählen nicht als Sturz
  assert.deepEqual(keys(patternHints(t, [inc(day(10)), inc(day(18), 'fall', meier, null, true)], now)), [])
})

test('Ohne Leserecht kein Name und kein Link', () => {
  const h = patternHints(t, [inc(day(10)), inc(day(18))], now, () => false)
  assert.equal(h.length, 1)
  assert.match(h[0].text, /^Eine Person/)
  assert.equal(h[0].href, undefined)
})

test('Mehrere Ereignisse verschiedener Typen bei derselben Person', () => {
  const rows = [inc(day(5), 'aggression'), inc(day(12), 'aggression'), inc(day(20), 'medication'), inc(day(21), 'aggression', keller)]
  const h = patternHints(t, rows, now)
  const any = h.find((x) => x.key === 'repeatAny:r1')!
  assert.match(any.text, /3 Ereignisse in 30 Tagen \(Aggressionsereignis 2, Medikationsereignis 1\)/)
  assert.equal(h.some((x) => x.key === 'repeatAny:r2'), false)
})

test('Häufung nach Tageszeit und Ort, Zunahme eines Typs', () => {
  const rows = [inc(day(3, 23), 'fall', keller, 'Bad'), inc(day(9, 2), 'fall', meier, 'Badezimmer'), inc(day(15, 3), 'fall', null, 'WC'), inc(day(20, 14), 'medication', keller, 'Zimmer')]
  const h = patternHints(t, rows, now)
  assert.ok(h.some((x) => x.key === 'time:night'))
  assert.ok(h.some((x) => x.key === 'place:bathroom'))
  assert.ok(h.some((x) => x.key === 'increase:fall' && x.href === '/quality?type=it-fall&period=30'))
})
