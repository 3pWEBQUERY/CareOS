import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RULES, cellKey, isNight, monthDays, restHours, rosterRules, shiftDay, shiftHours, sollHours, type RProblem } from './model'
import { evaluate } from './evaluate'
import { diffGrids, plan } from './solver'

const TYPES = [
  { code: 'F', start: '07:00', end: '15:30', breakMinutes: 30 },
  { code: 'S', start: '14:45', end: '23:00', breakMinutes: 30 },
  { code: 'N', start: '22:45', end: '07:15', breakMinutes: 0 },
]

function problem(over: Partial<RProblem> = {}): RProblem {
  const days = monthDays('2026-11')
  const people = Array.from({ length: 14 }, (_, i) => ({ id: 'u' + i, name: 'P' + i, pct: i % 3 === 0 ? 80 : 100, level: i < 5 ? 3 : 1, key: i < 5 }))
  return {
    days,
    before: Array.from({ length: 7 }, (_, i) => shiftDay(days[0], -(7 - i))),
    after: Array.from({ length: 7 }, (_, i) => shiftDay(days[days.length - 1], i + 1)),
    types: TYPES,
    targets: { F: 3, S: 3, N: 1 },
    people,
    absent: {},
    credit: {},
    wishes: {},
    locked: {},
    foreign: {},
    rules: DEFAULT_RULES,
    ...over,
  }
}

test('Zeiten: Dauer, Pause, Nacht und Ruhezeit', () => {
  assert.equal(shiftHours(TYPES[0]), 8)
  assert.equal(shiftHours(TYPES[2]), 8.5)
  assert.ok(isNight(TYPES[2]) && !isNight(TYPES[0]))
  assert.equal(restHours(TYPES[1], TYPES[0]), 8) // Spät 23:00 → Früh 07:00
  assert.ok(restHours(TYPES[2], TYPES[0]) < 0) // Nacht endet 07:15, Früh beginnt 07:00
  assert.equal(sollHours(DEFAULT_RULES, 100, monthDays('2026-11')), 21 * 8.4)
})

test('Regeln aus den Einstellungen: ungültige Werte fallen auf Standard zurück', () => {
  const r = rosterRules({ roster: { minRestHours: 12, maxConsecutiveDays: 99, weeklyHours: 'x' } })
  assert.equal(r.minRestHours, 12)
  assert.equal(r.maxConsecutiveDays, DEFAULT_RULES.maxConsecutiveDays)
  assert.equal(r.weeklyHours, DEFAULT_RULES.weeklyHours)
})

test('Automatische Planung verletzt keine harte Regel und besetzt den Monat', () => {
  const p = problem()
  const { grid } = plan(p, {}, { mode: 'replace' })
  const ev = evaluate(p, grid)
  assert.deepEqual(ev.issues.filter((i) => i.severity === 'error'), [])
  assert.ok(ev.coverageRate >= 95, `Abdeckung ${ev.coverageRate}`)
  // Jede Schicht mit Besetzung hat eine Schlüsselqualifikation
  assert.equal(ev.issues.filter((i) => i.code === 'keyQual').length, 0)
  // Niemand weit über Soll
  for (const s of Object.values(ev.people)) assert.ok(s.diff <= 12, `Überstunden ${s.diff}`)
})

test('Abwesenheiten, Wünsche und Einschränkungen werden beachtet', () => {
  const absent: RProblem['absent'] = {}
  for (const d of monthDays('2026-11').slice(9, 14)) absent[cellKey('u1', d)] = 'approved'
  const wishes: RProblem['wishes'] = { [cellKey('u2', '2026-11-20')]: { kind: 'off' }, [cellKey('u3', '2026-11-21')]: { kind: 'shift', code: 'N' } }
  const p = problem({ absent, wishes })
  const { grid } = plan(p, {}, { mode: 'replace', constraints: { u4: { allowed: ['F'] } } })
  for (const d of monthDays('2026-11').slice(9, 14)) assert.equal(grid[cellKey('u1', d)] ?? null, null)
  assert.equal(grid[cellKey('u2', '2026-11-20')] ?? null, null)
  assert.equal(grid[cellKey('u3', '2026-11-21')], 'N')
  for (const d of p.days) assert.ok(!grid[cellKey('u4', d)] || grid[cellKey('u4', d)] === 'F')
})

test('Startplan der KI: Regelverstösse werden entfernt und Lücken gefüllt', () => {
  const p = problem()
  const seed = { [cellKey('u0', '2026-11-02')]: 'S', [cellKey('u0', '2026-11-03')]: 'F', [cellKey('u5', '2026-11-02')]: 'X' }
  const { grid, repairs } = plan(p, {}, { mode: 'replace', seed })
  assert.ok(repairs.some((r) => r.user === 'u5' && r.reason === 'invalid'))
  assert.ok(repairs.some((r) => r.user === 'u0' && (r.day === '2026-11-02' || r.day === '2026-11-03') && r.reason === 'rule'))
  assert.ok(!(grid[cellKey('u0', '2026-11-02')] === 'S' && grid[cellKey('u0', '2026-11-03')] === 'F'))
  assert.deepEqual(evaluate(p, grid).issues.filter((i) => i.severity === 'error'), [])
})

test('Modus «fill» lässt bestehende Dienste und gesperrte Zellen unverändert', () => {
  const current = { [cellKey('u6', '2026-11-05')]: 'N' }
  const p = problem({ locked: { [cellKey('u7', '2026-11-01')]: 'F' }, foreign: {} })
  const { grid } = plan(p, current, { mode: 'fill' })
  assert.equal(grid[cellKey('u6', '2026-11-05')], 'N')
  assert.equal(grid[cellKey('u7', '2026-11-01')], undefined)
  assert.ok(diffGrids(p, current, grid).every((c) => c.from === null))
})

test('Ruhezeit über die Monatsgrenze (Kontext aus dem Vormonat)', () => {
  const p = problem({ locked: { [cellKey('u8', '2026-10-31')]: 'N' } })
  const { grid } = plan(p, {}, { mode: 'replace' })
  assert.notEqual(grid[cellKey('u8', '2026-11-01')], 'F')
  assert.deepEqual(evaluate(p, grid).issues.filter((i) => i.severity === 'error'), [])
})
