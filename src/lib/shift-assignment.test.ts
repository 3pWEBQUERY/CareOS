import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanPairs, diffPairs, roomRanges, suggestAssignments } from './assignment-plan'
import { listShort, medChanges, planDiff, schedule, type MedLike } from './shift-changes'
import { defaultHomeView, homeViews, pickHomeView, type HomeViewInput } from './home-view'

const R = (ids: string[], primary: Record<string, string> = {}) => ids.map((id) => ({ id, primaryNurseId: primary[id] ?? null }))

test('Zuteilung: Kontinuität aus der letzten Schicht vor Bezugsperson', () => {
  const s = suggestAssignments({
    residents: R(['r1', 'r2', 'r3', 'r4'], { r1: 'b', r2: 'b' }),
    staff: ['a', 'b'],
    history: [{ residentId: 'r1', userId: 'a', at: 2 }, { residentId: 'r1', userId: 'b', at: 1 }],
  })
  const of = (rid: string) => s.pairs.find((p) => p.residentId === rid)?.userId
  assert.equal(of('r1'), 'a') // neueste Betreuung gewinnt
  assert.equal(s.source.r1, 'history')
  assert.equal(of('r2'), 'b') // Bezugsperson
  assert.equal(s.source.r2, 'primary')
  assert.equal(s.pairs.length, 4)
})

test('Zuteilung: niemand mehr als ⌈n/Personen⌉, Rest gleichmässig und nach Zimmern zusammenhängend', () => {
  const residents = R(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
  // Gestern war nur «a» im Dienst und hatte alle
  const history = residents.map((r) => ({ residentId: r.id, userId: 'a', at: 1 }))
  const s = suggestAssignments({ residents, staff: ['a', 'b', 'c'], history })
  const load = (u: string) => s.pairs.filter((p) => p.userId === u).length
  assert.deepEqual([load('a'), load('b'), load('c')], [2, 2, 2])
  assert.deepEqual(s.pairs.filter((p) => p.userId === 'a').map((p) => p.residentId), ['r1', 'r2'])
  assert.deepEqual(s.pairs.filter((p) => p.userId === 'b').map((p) => p.residentId), ['r3', 'r4'])
})

test('Zuteilung: Personen ausser Dienst werden nicht vorgeschlagen; ohne Personal kein Vorschlag', () => {
  const s = suggestAssignments({ residents: R(['r1', 'r2'], { r1: 'x' }), staff: ['a'], history: [{ residentId: 'r2', userId: 'y', at: 1 }] })
  assert.deepEqual(s.pairs.map((p) => p.userId), ['a', 'a'])
  assert.deepEqual(suggestAssignments({ residents: R(['r1']), staff: [], history: [] }).pairs, [])
})

test('Zuteilung: Unterschied und Bereinigung', () => {
  const before = [{ residentId: 'r1', userId: 'a' }, { residentId: 'r2', userId: 'a' }]
  const after = [{ residentId: 'r1', userId: 'a' }, { residentId: 'r2', userId: 'b' }]
  assert.deepEqual(diffPairs(before, after), { added: [{ residentId: 'r2', userId: 'b' }], removed: [{ residentId: 'r2', userId: 'a' }] })
  assert.deepEqual(cleanPairs([...after, after[0], { residentId: 'rX', userId: 'a' }], ['r1', 'r2'], ['a', 'b']), after)
})

test('Zimmer als Bereiche', () => {
  assert.equal(roomRanges(['203', '201', '202', '205']), '201–203, 205')
  assert.equal(roomRanges(['A', '101']), '101, A')
  assert.equal(roomRanges([]), '')
})

const med = (p: Partial<MedLike> & { id: string }): MedLike => ({
  residentId: 'r1', name: 'Metformin', form: 'Tbl.', kind: 'regular', times: ['08:00'], doses: ['1'], prnDose: null, createdAt: new Date(0), stoppedAt: null, ...p,
})

test('Verordnungen: Änderung = neu + gleichzeitig abgesetzt; sonst neu bzw. abgesetzt', () => {
  const t0 = new Date('2026-10-22T08:00:00')
  const old = med({ id: 'old', stoppedAt: t0 })
  const neu = med({ id: 'new', createdAt: new Date(t0.getTime() + 300), times: ['08:00', '18:00'], doses: ['1', '1'] })
  const other = med({ id: 'x', name: 'Torasemid', createdAt: new Date('2026-10-22T10:00:00') })
  const stop = med({ id: 'y', name: 'Marcoumar', residentId: 'r2', stoppedAt: new Date('2026-10-22T11:00:00') })
  const c = medChanges([neu, other], [old, stop])
  assert.deepEqual(c.map((x) => x.type + ':' + x.med.id), ['changed:new', 'started:x', 'stopped:y'])
  // Audit-Verweis hat Vorrang vor der Zeitnähe
  const viaAudit = medChanges([neu], [old, med({ id: 'old2', stoppedAt: t0 })], new Map([['new', 'old2']]))
  const changed = viaAudit.find((x) => x.type === 'changed')
  assert.equal(changed?.type === 'changed' && changed.old.id, 'old2')
  assert.ok(viaAudit.some((x) => x.type === 'stopped' && x.med.id === 'old'))
})

test('Verordnungen: Dosierschema mit Einheit', () => {
  const dose = (d: string, f: string | null) => `${d} ${f ?? ''}`.trim()
  assert.equal(schedule(med({ id: 'a', times: ['08:00', '20:00'], doses: ['1', '½'] }), dose, 'Reserve'), '08:00 1 Tbl. · 20:00 ½ Tbl.')
  assert.equal(schedule(med({ id: 'b', kind: 'prn', prnDose: '500 mg', form: null }), dose, 'Reserve'), 'Reserve 500 mg')
})

test('Pflegeplanung: neue, entfallene und angepasste Massnahmen', () => {
  const iv = (title: string, times: string[] = ['08:00'], instructions: string | null = null) => ({ title, category: 'Pflege', times, weekdays: [], instructions })
  const d = planDiff([iv('Lagerung', ['08:00', '12:00']), iv('Mobilisation'), iv('Körperpflege')], [iv('Lagerung', ['08:00', '12:00', '16:00']), iv('Körperpflege'), iv('Trinkprotokoll')])
  assert.deepEqual(d, { added: ['Trinkprotokoll'], removed: ['Mobilisation'], changed: ['Lagerung'] })
  assert.equal(listShort(['A', 'B', 'C', 'D', 'E']), 'A, B, C +2')
})

const base: HomeViewInput = { careHere: false, onDutyHere: false, clinicalUnits: 0, leadPerms: false, quality: false, office: false }

test('Startseite nach Rolle: Pflege, Leitung, QM, HR, Admin', () => {
  const nurse = { ...base, careHere: true, onDutyHere: true, clinicalUnits: 1 }
  assert.deepEqual(homeViews(nurse), ['care'])
  const lead = { ...base, careHere: true, clinicalUnits: 2, leadPerms: true, quality: true }
  assert.deepEqual(homeViews(lead), ['care', 'lead'])
  assert.equal(defaultHomeView(lead), 'lead')
  assert.equal(defaultHomeView({ ...lead, onDutyHere: true }), 'care') // im Dienst: Station
  const qm = { ...base, quality: true }
  assert.deepEqual(homeViews(qm), ['quality'])
  const hr = { ...base, leadPerms: true, office: true }
  assert.deepEqual(homeViews(hr), ['office'])
  const admin = { ...base, careHere: true, clinicalUnits: 3, leadPerms: true, quality: true, office: true }
  assert.deepEqual(homeViews(admin), ['care', 'lead', 'office'])
  assert.equal(defaultHomeView(admin), 'office')
  assert.deepEqual(homeViews(base), ['office']) // nie leer
  assert.equal(pickHomeView(lead, 'care').view, 'care')
  assert.equal(pickHomeView(qm, 'care').view, 'quality') // nicht verfügbar → Standard
})
