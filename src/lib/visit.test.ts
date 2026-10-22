import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeT } from '../i18n/core'
import visitMessages from '../i18n/messages/visit'
import { defaultDue, isEmptyVisit, orderKindOfTitle, orderTask, orderTitle, vitalChanges, visitSince, visitSummary, ORDER_KINDS } from './visit'
import { defaultLimits } from './vitals'
import { taskTitle } from './task-title'

const t = makeT({ visit: visitMessages.de, tasks: {}, quality: {}, care: {} }, 'de', 'resident')
const tFr = makeT({ visit: visitMessages.fr }, 'fr', 'resident')
const at = (h: number, m = 0, d = 22) => new Date(2026, 9, d, h, m)

test('Visite: Aufgabe aus Anordnung – Titel, Kategorie, Priorität, Fälligkeit', () => {
  const now = at(10, 7)
  const med = orderTask({ kind: 'medication', text: ' Metformin auf 850 mg 1-0-1 ', dueAt: null }, now, 'Dr. med. P. Keller')
  assert.equal(med.title, 'visit.order.medication')
  assert.equal(med.category, 'Medikation')
  assert.equal(med.priority, 'important')
  assert.equal(med.description, 'Metformin auf 850 mg 1-0-1 (Dr. med. P. Keller)')
  assert.equal(med.dueAt.getTime(), at(11, 15).getTime()) // +1 h, auf 15 Min. aufgerundet
  const lab = orderTask({ kind: 'lab', text: 'HbA1c', dueAt: null }, now)
  assert.equal(lab.priority, 'routine')
  assert.equal(lab.category, 'Behandlungspflege')
  assert.equal(lab.description, 'HbA1c')
  assert.equal(lab.dueAt.getTime(), at(14, 15).getTime()) // +4 h
  const fixed = orderTask({ kind: 'check', text: 'BD 2× täglich', dueAt: at(7, 30, 23) }, now)
  assert.equal(fixed.dueAt.getTime(), at(7, 30, 23).getTime())
  assert.equal(fixed.category, 'Überwachung')
  for (const k of ORDER_KINDS) assert.equal(orderKindOfTitle(orderTitle(k)), k)
  assert.equal(orderKindOfTitle('medication.slot'), null)
})

test('Visite: Standardfälligkeit – keine Nachtaufgaben, sonst Folgetag 08:00', () => {
  assert.equal(defaultDue('lab', at(19, 0)).getTime(), at(8, 0, 23).getTime()) // 23:00 wäre zu spät
  assert.equal(defaultDue('medication', at(20, 20)).getTime(), at(21, 30).getTime())
  assert.equal(defaultDue('medication', at(20, 31)).getTime(), at(8, 0, 23).getTime())
  assert.equal(defaultDue('other', at(23, 10)).getTime(), at(8, 0, 23).getTime())
})

test('Visite: Zeitraum seit letzter Visite', () => {
  const now = at(10)
  assert.deepEqual(visitSince([null, undefined], now), { since: new Date(2026, 9, 8, 10), fromVisit: false })
  const s = visitSince([at(9, 30, 15), at(10, 0, 18)], now)
  assert.equal(s.since.getTime(), at(10, 0, 18).getTime())
  assert.equal(s.fromVisit, true)
  // nie mehr als 30 Tage
  assert.equal(visitSince([new Date(2026, 5, 1)], now).since.getTime(), new Date(2026, 8, 22, 10).getTime())
})

test('Visite: auffällige Vitalwerte mit Trend und auffälligstem Wert', () => {
  const lim = defaultLimits()
  const rows = [
    { at: at(8, 0, 19), temp: 36.8, sys: 130, glucose: 7 },
    { at: at(8, 0, 20), temp: 38.4, sys: 162, glucose: 11.8 },
    { at: at(8, 0, 21), temp: 37.9, sys: 128, glucose: 9 },
    { at: at(8, 0, 22), temp: 38.1, sys: 131, weight: 64 },
    { at: at(8, 0, 10), temp: 39.5 }, // vor dem Zeitraum
  ]
  const c = vitalChanges(rows, lim, at(0, 0, 19))
  const temp = c.find((x) => x.key === 'temp')!
  assert.equal(temp.last, 38.1)
  assert.equal(temp.lastFlag, 'hi')
  assert.equal(temp.peak, 38.4)
  assert.equal(temp.abnormal, 2)
  assert.equal(temp.count, 4)
  assert.equal(temp.trend, 'up')
  const sys = c.find((x) => x.key === 'sys')!
  assert.equal(sys.lastFlag, '') // zuletzt wieder im Referenzbereich
  assert.equal(sys.peak, 162)
  assert.ok(c.find((x) => x.key === 'glucose'))
  assert.equal(c.find((x) => x.key === 'glucose')!.trend, 'down')
  assert.equal(c.find((x) => x.key === 'pulse'), undefined)
  // Gewicht erst ab ±2 kg
  assert.equal(c.find((x) => x.key === 'weight'), undefined)
  const w = vitalChanges([{ at: at(8, 0, 19), weight: 66.5 }, { at: at(8, 0, 22), weight: 64.1 }], lim, at(0, 0, 19))
  assert.equal(w[0]?.key, 'weight')
  assert.equal(w[0]?.trend, 'down')
})

test('Visite: Zusammenfassung für den Verlauf (Document Once)', () => {
  const when = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}. ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  const text = visitSummary(t, {
    physician: 'Dr. med. P. Keller',
    answers: [{ question: 'BZ erhöht – Therapie anpassen?', answer: 'Metformin erhöhen' }, { question: 'Schlaf?', answer: '' }],
    orders: [{ kind: 'medication', text: 'Metformin 850 mg 1-0-1', dueAt: at(11, 15) }, { kind: 'lab', text: 'HbA1c', dueAt: at(7, 30, 23) }],
    note: 'Tochter informiert',
  }, when)
  assert.equal(text, [
    'Arztvisite Dr. med. P. Keller.',
    'Anordnungen:',
    '- Medikation prüfen/ändern: Metformin 850 mg 1-0-1 (Verordnung in der Medikation anpassen) · fällig 22.10. 11:15',
    '- Labor: HbA1c · fällig 23.10. 7:30',
    'Fragen der Pflege:',
    '- BZ erhöht – Therapie anpassen? → Metformin erhöhen',
    '- Schlaf? → offen, nächste Visite',
    'Notiz: Tochter informiert',
  ].join('\n'))
  const empty = visitSummary(t, { physician: null, answers: [], orders: [], note: '' }, when)
  assert.equal(empty, 'Arztvisite.\nVisite durchgeführt, keine neuen Anordnungen.')
  assert.ok(visitSummary(tFr, { physician: null, answers: [], orders: [], note: null }, when).includes('aucun nouvel ordre'))
  assert.equal(isEmptyVisit({ answers: [{ answer: ' ' }], orders: [], note: '' }), true)
  assert.equal(isEmptyVisit({ answers: [{ answer: 'ok' }], orders: [], note: '' }), false)
  assert.equal(isEmptyVisit({ answers: [], orders: [{}], note: null }), false)
})

test('Visite: Aufgabentitel in jeder Sprache lesbar', () => {
  assert.equal(taskTitle(t, { title: 'visit.order.medication', dueAt: at(10) }), 'Verordnung anpassen')
  assert.equal(taskTitle(tFr, { title: 'visit.order.lab', dueAt: at(10) }), 'Organiser le laboratoire')
  assert.equal(taskTitle(t, { title: 'Freitext', dueAt: at(10) }), 'Freitext')
})
