import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  absenceBusy, appendSequences, klvTotals, moveInTour, overlappingVisits, parseServices, proofCsvRows, serviceMinutes, shiftBusy,
  templateOccursOn, templateSchema, tourOrder, visitConflicts, visitSchema, visitsForDay, visitWindow, type TemplateLike,
} from './spitex'

const day = (d: number, time = '00:00') => new Date(`2026-10-${String(d).padStart(2, '0')}T${time}:00`)
const svc = [{ klv: 'c', label: 'Körperpflege', minutes: 30 }, { klv: 'b', label: 'Medikamente', minutes: 10 }]
const tpl = (over: Partial<TemplateLike> = {}): TemplateLike => ({
  id: 't1', residentId: 'r1', weekdays: [1, 3, 5], start: '08:00', end: '08:45', services: svc, preferredUserId: 'u1',
  startDate: day(1), endDate: null, active: true, ...over,
})

test('Spitex: Wochenvorlage gilt an ihren Wochentagen innerhalb der Gültigkeit', () => {
  // 2026-10-26 ist ein Montag
  assert.equal(templateOccursOn(tpl(), day(26)), true)
  assert.equal(templateOccursOn(tpl(), day(27)), false)
  assert.equal(templateOccursOn(tpl({ startDate: day(27) }), day(26)), false)
  assert.equal(templateOccursOn(tpl({ endDate: day(25) }), day(26)), false)
  assert.equal(templateOccursOn(tpl({ endDate: day(26) }), day(26)), true)
  assert.equal(templateOccursOn(tpl({ active: false }), day(26)), false)
})

test('Spitex: Einsätze aus Vorlagen – idempotent, nur aktive Klient/innen, bevorzugte Person ausser bei Abwesenheit', () => {
  const templates = [
    tpl(),
    tpl({ id: 't2', residentId: 'r2', start: '07:15', end: '07:30', preferredUserId: 'u2' }),
    tpl({ id: 't3', residentId: 'r3' }),
    tpl({ id: 't4', residentId: 'r1', weekdays: [2] }),
  ]
  const active = new Set(['r1', 'r2'])
  const rows = visitsForDay(templates, day(26), { existing: new Set(), activeResidents: active, unavailable: new Set(['u2']) })
  // r3 nicht aktiv, t4 nicht am Montag; nach Beginn sortiert
  assert.deepEqual(rows.map((r) => r.templateId), ['t2', 't1'])
  assert.equal(rows[0].assigneeId, null, 'abwesende bevorzugte Person → zur Disposition offen')
  assert.equal(rows[1].assigneeId, 'u1')
  assert.equal(rows[1].plannedStart.getTime(), day(26, '08:00').getTime())
  assert.equal(rows[1].plannedEnd.getTime(), day(26, '08:45').getTime())
  assert.deepEqual(rows[1].services, svc)
  // Zweiter Lauf: bereits erzeugte (auch abgesagte) Vorlagen erzeugen nichts mehr
  const again = visitsForDay(templates, day(26), { existing: new Set(rows.map((r) => r.templateId)), activeResidents: active })
  assert.deepEqual(again, [])
  // Nach Beginn des Zeitfensters angelegt/geändert: heute kein nachträglicher Einsatz
  const late = visitsForDay([tpl({ updatedAt: day(26, '09:00') })], day(26), { existing: new Set(), activeResidents: active })
  assert.deepEqual(late, [])
  const early = visitsForDay([tpl({ updatedAt: day(26, '07:00') })], day(26), { existing: new Set(), activeResidents: active })
  assert.equal(early.length, 1)
})

test('Spitex: ungültige Leistungen in Vorlagen werden übergangen, ohne Leistung kein Einsatz', () => {
  assert.deepEqual(parseServices([{ klv: 'x', label: 'A', minutes: 5 }, { klv: 'a', label: 'Beratung', minutes: '15' }, null]), [{ klv: 'a', label: 'Beratung', minutes: 15 }])
  assert.deepEqual(parseServices('kaputt'), [])
  assert.deepEqual(visitsForDay([tpl({ services: [] })], day(26), { existing: new Set(), activeResidents: new Set(['r1']) }), [])
})

test('Spitex: neue Einsätze werden hinten an die Tour der Person angehängt', () => {
  const rows = appendSequences([{ assigneeId: 'u1', sequence: 0 }, { assigneeId: 'u1', sequence: 4 }, { assigneeId: null, sequence: 1 }], [
    { assigneeId: 'u1' }, { assigneeId: 'u2' }, { assigneeId: 'u1' }, { assigneeId: null },
  ])
  assert.deepEqual(rows.map((r) => r.sequence), [5, 0, 6, 2])
})

test('Spitex: Tourreihenfolge nach Position, dann Beginn; Verschieben um eine Position', () => {
  const v = (id: string, sequence: number, time: string) => ({ id, sequence, plannedStart: day(26, time) })
  assert.deepEqual(tourOrder([v('c', 1, '07:00'), v('a', 0, '10:00'), v('b', 1, '06:00')]).map((x) => x.id), ['a', 'b', 'c'])
  assert.deepEqual(moveInTour(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b'])
  assert.deepEqual(moveInTour(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'])
  assert.deepEqual(moveInTour(['a', 'b', 'c'], 'x', 1), ['a', 'b', 'c'])
})

test('Spitex: Überschneidungen – Berührung zählt nicht, abgesagte zählen nicht, erfasste Zeiten gelten', () => {
  const v = (id: string, from: string, to: string, extra: Partial<{ status: string; actualStart: Date; actualEnd: Date }> = {}) =>
    ({ id, status: 'planned', plannedStart: day(26, from), plannedEnd: day(26, to), ...extra })
  const m = overlappingVisits([
    v('a', '08:00', '08:30'),
    v('b', '08:30', '09:00'), // berührt a
    v('c', '08:45', '09:15'), // überschneidet b
    v('d', '08:00', '09:30', { status: 'cancelled' }),
  ])
  assert.deepEqual(m.get('a'), undefined)
  assert.deepEqual(m.get('b'), ['c'])
  assert.deepEqual(m.get('c'), ['b'])
  assert.equal(m.has('d'), false)
  // Gestartet um 08:20 mit geplanter Dauer 30 Min. → bis 08:50, überschneidet den Einsatz ab 08:40
  const started = v('e', '08:00', '08:30', { status: 'started', actualStart: day(26, '08:20') })
  assert.equal(visitWindow(started).end.getTime(), day(26, '08:50').getTime())
  assert.deepEqual(overlappingVisits([started, v('f', '08:40', '09:00')]).get('f'), ['e'])
})

test('Spitex: Konflikthinweise bei Abwesenheit und Stationsdienst', () => {
  const visits = [
    { id: 'a', status: 'planned', plannedStart: day(26, '06:30'), plannedEnd: day(26, '07:00') },
    { id: 'b', status: 'planned', plannedStart: day(26, '16:00'), plannedEnd: day(26, '16:30') },
    { id: 'c', status: 'done', plannedStart: day(26, '15:00'), plannedEnd: day(26, '15:20') },
  ]
  // Nachtdienst vom Vortag bis 07:15, Spätdienst ab 14:45
  const busy = [shiftBusy(day(25), '22:45', '07:15', 'N · WG 2'), shiftBusy(day(26), '14:45', '23:00', 'S · WG 2')]
  const c = visitConflicts(visits, busy)
  assert.deepEqual(c.get('a'), [{ kind: 'shift', label: 'N · WG 2' }])
  assert.deepEqual(c.get('b'), [{ kind: 'shift', label: 'S · WG 2' }])
  assert.equal(c.has('c'), false, 'erledigte Einsätze ohne Hinweis')
  // Überschneidung: nur der offene Einsatz erhält den Hinweis
  const o = visitConflicts([{ id: 'x', status: 'done', plannedStart: day(26, '08:00'), plannedEnd: day(26, '08:40') }, { id: 'y', status: 'planned', plannedStart: day(26, '08:30'), plannedEnd: day(26, '09:00') }], [])
  assert.equal(o.has('x'), false)
  assert.deepEqual(o.get('y'), [{ kind: 'overlap', with: 'x' }])
  const abs = visitConflicts(visits.slice(0, 1), [absenceBusy(day(24), day(26), 'Ferien')])
  assert.deepEqual(abs.get('a'), [{ kind: 'absence', label: 'Ferien' }])
  assert.equal(visitConflicts(visits.slice(0, 1), [absenceBusy(day(27), day(28), 'Ferien')]).size, 0)
})

test('Spitex: Minuten je KLV-Kategorie nur aus abgeschlossenen Einsätzen und erbrachten Leistungen', () => {
  const s = (klv: string, plannedMin: number, actualMin: number | null, done: boolean) => ({ klv, plannedMin, actualMin, done })
  assert.equal(serviceMinutes(s('c', 30, null, true)), 30)
  assert.equal(serviceMinutes(s('c', 30, 25, true)), 25)
  assert.equal(serviceMinutes(s('c', 30, 25, false)), 0)
  const totals = klvTotals([
    { status: 'done', services: [s('c', 30, 35, true), s('b', 10, null, true), s('a', 15, 15, false)] },
    { status: 'done', services: [s('a', 20, 20, true), s('x', 5, 5, true)] },
    { status: 'missed', services: [s('c', 30, 30, true)] },
    { status: 'started', services: [s('b', 10, 10, true)] },
  ])
  assert.deepEqual(totals, { a: 20, b: 10, c: 35, total: 65, visits: 2 })
})

test('Spitex: Leistungsnachweis als CSV mit Summenzeile', () => {
  const rows = proofCsvRows([
    { date: day(5), start: day(5, '08:02'), end: day(5, '08:40'), staff: 'S. Frei', services: [{ klv: 'c', label: 'Körperpflege', plannedMin: 30, actualMin: 32, done: true }, { klv: 'b', label: 'Medikamente', plannedMin: 10, actualMin: null, done: false }] },
    { date: day(6), start: day(6, '08:00'), end: day(6, '08:15'), staff: 'M. Rossi', services: [{ klv: 'b', label: 'Medikamente', plannedMin: 10, actualMin: 8, done: true }] },
  ], { header: ['Datum', 'Beginn', 'Ende', 'Person', 'Leistungen', 'a', 'b', 'c', 'Total'], total: 'Total', dateKey: (d) => d.toISOString().slice(0, 10) })
  assert.equal(rows.length, 4)
  assert.deepEqual(rows[1].slice(1), ['08:02', '08:40', 'S. Frei', 'Körperpflege (c)', '0', '0', '32', '32'])
  assert.deepEqual(rows[3], ['Total', '', '', '', '', '0', '8', '32', '40'])
})

test('Spitex: Validierung von Einsatz und Wochenvorlage (Fehler als i18n-Schlüssel)', () => {
  const base = { id: '', residentId: 'r1', date: '2026-10-26', start: '08:00', end: '08:30', assigneeId: '', note: '', services: svc }
  assert.equal(visitSchema.safeParse(base).success, true)
  const bad = visitSchema.safeParse({ ...base, end: '07:30' })
  assert.equal(bad.success, false)
  assert.equal(bad.error?.issues[0].message, 'spitex.errors.endBeforeStart')
  assert.equal(visitSchema.safeParse({ ...base, services: [] }).error?.issues[0].message, 'spitex.errors.services')
  const t = { id: '', residentId: 'r1', weekdays: ['1', '3'], start: '08:00', end: '08:30', preferredUserId: '', startDate: '2026-10-26', endDate: '', note: '', services: svc }
  assert.deepEqual(templateSchema.parse(t).weekdays, [1, 3])
  assert.equal(templateSchema.safeParse({ ...t, weekdays: [] }).error?.issues[0].message, 'spitex.errors.weekdays')
  assert.equal(templateSchema.safeParse({ ...t, endDate: '2026-10-01' }).error?.issues[0].message, 'spitex.errors.endDate')
})
