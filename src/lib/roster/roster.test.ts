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

test('KI: Prompt enthält Regeln, Personen, Abwesenheiten, Wünsche und Anweisungen', async () => {
  const { buildPrompt } = await import('./ai-format')
  const p = problem({
    absent: { [cellKey('u1', '2026-11-10')]: 'approved', [cellKey('u1', '2026-11-11')]: 'approved' },
    wishes: { [cellKey('u2', '2026-11-20')]: { kind: 'off' } },
    locked: { [cellKey('u3', '2026-10-31')]: 'N' },
  })
  const { system, user, alias } = buildPrompt(p, { [cellKey('u0', '2026-11-02')]: 'F' }, 'fill', 'November 2026', 'P2 keine Nachtdienste', 'de')
  assert.match(system, /mindestens 11 Stunden/)
  assert.match(user, /Tage 1–30/)
  assert.match(user, /P1 \| P0 \| Weitere \| 80 %/)
  assert.match(user, /fix: 2 F/)
  assert.match(user, /abwesend: 10–11/)
  assert.match(user, /Wünsche: frei 20/)
  assert.match(user, /Vormonat \(Tage vor dem 1\.\): -1 N/)
  assert.match(user, /<anweisungen>\nP2 keine Nachtdienste\n<\/anweisungen>/)
  assert.equal(alias.get('u0'), 'P1')
  // Krankheit o. ä. wird nicht übermittelt
  assert.doesNotMatch(user, /krank|Ferien/i)
})

test('KI: Antwort wird übersetzt und vom Solver regelkonform gemacht', async () => {
  const { buildPrompt, readAiResult, aiSchema } = await import('./ai-format')
  const p = problem()
  const { alias } = buildPrompt(p, {}, 'replace', 'November 2026', '', 'de')
  const days = p.days.length
  const raw = {
    plan: [
      { person: 'P1', shifts: Array.from({ length: days }, (_, i) => (i === 1 ? 'S' : i === 2 ? 'F' : '')) },
      { person: 'P99', shifts: Array(days).fill('F') },
    ],
    constraints: [{ person: 'P2', allowed: ['F'], offDays: [12, 40] }],
    notes: ['Am 5. fehlt eine Nacht, weil P3 abwesend ist.'],
  }
  const parsed = aiSchema(['F', 'S', 'N']).parse(raw)
  const r = readAiResult(p, alias, parsed)
  assert.equal(r.seed[cellKey('u0', '2026-11-02')], 'S')
  assert.deepEqual(r.constraints.u1, { allowed: ['F'], offDays: ['2026-11-12'] })
  assert.equal(r.notes[0], 'Am 5. fehlt eine Nacht, weil P2 abwesend ist.')
  const { grid } = plan(p, {}, { mode: 'replace', seed: r.seed, constraints: r.constraints })
  assert.deepEqual(evaluate(p, grid).issues.filter((i) => i.severity === 'error'), [])
  for (const d of p.days) assert.ok(!grid[cellKey('u1', d)] || grid[cellKey('u1', d)] === 'F')
  assert.equal(grid[cellKey('u1', '2026-11-12')] ?? null, null)
  assert.throws(() => aiSchema(['F']).parse({ plan: [{ person: 'P1', shifts: ['Q'] }], constraints: [], notes: [] }))
})

test('Wünsche haben Vorrang: Frei-Wünsche bleiben frei, Dienst-Wünsche werden erfüllt, auch gegen den Startplan', () => {
  const days = monthDays('2026-11')
  const wishes: RProblem['wishes'] = {}
  for (const [i, d] of days.entries()) {
    if (i % 3 === 0) wishes[cellKey('u' + (i % 14), d)] = { kind: 'off' }
    if (i % 4 === 1) wishes[cellKey('u' + ((i + 5) % 14), d)] = { kind: 'shift', code: i % 8 === 1 ? 'N' : 'F' }
  }
  const p = problem({ wishes })
  // Startplan setzt genau die Frei-Wunsch-Tage ein
  const seed: Record<string, string> = {}
  for (const [k, w] of Object.entries(wishes)) if (w.kind === 'off') seed[k] = 'F'
  const { grid } = plan(p, {}, { mode: 'replace', seed })
  const ev = evaluate(p, grid)
  assert.deepEqual(ev.issues.filter((i) => i.severity === 'error'), [])
  for (const [k, w] of Object.entries(wishes)) if (w.kind === 'off') assert.equal(grid[k] ?? null, null, `Frei-Wunsch ${k}`)
  assert.ok(ev.wishes.met / ev.wishes.total >= 0.9, `Wünsche ${ev.wishes.met}/${ev.wishes.total}`)
})

test('Vorgaben je Person (nur bestimmte Dienste, max. Nächte) und Soll-Besetzung nur an Wochentagen', () => {
  const p = problem({
    types: [...TYPES, { code: 'ST', start: '09:00', end: '13:00', breakMinutes: 0 }],
    targets: { F: 3, S: 3, N: 1, ST: 1 },
    targetDays: { ST: [1, 2, 3, 4, 5] },
  })
  p.people[0] = { ...p.people[0], allowed: ['F'] }
  p.people[1] = { ...p.people[1], maxNights: 2 }
  p.people[2] = { ...p.people[2], preferred: ['ST'] }
  const { grid } = plan(p, {}, { mode: 'replace' })
  for (const d of p.days) {
    const v = grid[cellKey('u0', d)]
    assert.ok(!v || v === 'F', `u0 ${d} ${v}`)
    const st = p.people.filter((x) => grid[cellKey(x.id, d)] === 'ST').length
    const wd = new Date(d + 'T00:00:00Z').getUTCDay()
    assert.equal(st, wd === 0 || wd === 6 ? 0 : 1, `Stübli ${d}`)
  }
  assert.ok(p.days.filter((d) => grid[cellKey('u1', d)] === 'N').length <= 2)
  assert.ok(p.days.filter((d) => grid[cellKey('u2', d)] === 'ST').length >= 8)
})

test('Dienstart-Regeln: nur bestimmte Funktionen, Mindestbesetzung je Funktion, Soll je Wochentag', () => {
  const groups = ['lead', 'hf', 'hf', 'hf', 'hf', 'fage', 'fage', 'fage', 'fage', 'srk', 'srk', 'srk', 'srk', 'srk'] as const
  const base = problem({
    types: [...TYPES, { code: 'ST', start: '09:00', end: '13:00', breakMinutes: 0 }],
    targets: { F: 3, S: 3, N: 1, ST: 1 },
    targetByDay: { ST: [0, 1, 1, 1, 1, 1, 0], F: [2, 3, 3, 3, 3, 3, 2] },
    shiftRules: { ST: { groups: ['srk'] }, F: { min: { hf: 1, fage: 1 } }, N: { groups: ['hf', 'fage'], min: { hf: 1 } } },
  })
  const p = { ...base, people: base.people.map((x, i) => ({ ...x, key: false, group: groups[i] })) }
  const { grid } = plan(p, {}, { mode: 'replace' })
  const ev = evaluate(p, grid)
  assert.deepEqual(ev.issues.filter((i) => i.severity === 'error'), [])
  const groupOf = new Map(p.people.map((x) => [x.id, x.group]))
  for (const d of p.days) {
    const on = (c: string) => p.people.filter((x) => grid[cellKey(x.id, d)] === c)
    for (const x of on('ST')) assert.equal(groupOf.get(x.id), 'srk', `Stübli ${d} ${x.id}`)
    for (const x of on('N')) assert.notEqual(groupOf.get(x.id), 'srk')
    assert.ok(on('F').some((x) => groupOf.get(x.id) === 'hf'), `F ohne HF ${d}`)
    const wd = new Date(d + 'T00:00:00Z').getUTCDay()
    assert.equal(on('F').length, wd === 0 || wd === 6 ? 2 : 3, `F ${d}`)
  }
  assert.equal(ev.issues.filter((i) => i.code === 'groupMin').length, 0)
})

test('Modus «adjust»: Überbesetzung und unzulässige bestehende Dienste werden abgebaut, passende bleiben', () => {
  const base = problem({ shiftRules: { N: { groups: ['hf'] } } })
  const p = { ...base, people: base.people.map((x, i) => ({ ...x, group: (i < 5 ? 'hf' : 'srk') as 'hf' | 'srk' })) }
  const current: Record<string, string> = {}
  for (let i = 0; i < 8; i++) current[cellKey('u' + i, '2026-11-10')] = 'F' // 8 statt 3
  current[cellKey('u9', '2026-11-11')] = 'N' // SRK darf keine Nacht
  const { grid } = plan(p, current, { mode: 'adjust' })
  assert.equal(p.people.filter((x) => grid[cellKey(x.id, '2026-11-10')] === 'F').length, 3)
  assert.notEqual(grid[cellKey('u9', '2026-11-11')], 'N')
  const fill = plan(p, current, { mode: 'fill' }).grid
  assert.equal(p.people.filter((x) => fill[cellKey(x.id, '2026-11-10')] === 'F').length, 8)
  const ev = evaluate(p, fill)
  assert.ok(ev.issues.some((i) => i.code === 'notEligible' && i.user === 'u9'))
})
