import { test } from 'node:test'
import assert from 'node:assert/strict'
import { careRecurrence, planSchema, reviewDue, sessionSchema, weekProgress, weekStart } from './therapy'
import { occursOn } from './recurrence'

test('Therapie: Pflege-Anleitung wiederholt sich täglich bis zum Planende (Grundlage für ensureTasksForDay)', () => {
  const start = new Date('2026-10-23T00:00:00')
  const end = new Date('2026-10-30T00:00:00')
  const day = (d: number) => new Date(2026, 9, d)
  // Vor der Uhrzeit angelegt: erste Aufgabe heute
  const early = careRecurrence(start, '10:00', end, new Date('2026-10-23T08:00:00'))
  assert.deepEqual(early.times, ['10:00'])
  assert.equal(occursOn(early, day(23)), true)
  assert.equal(occursOn(early, day(27)), true)
  assert.equal(occursOn(early, day(30)), true)
  assert.equal(occursOn(early, day(31)), false)
  assert.equal(occursOn(early, day(22)), false)
  // Nach der Uhrzeit angelegt: keine sofort überfällige Aufgabe, Beginn am Folgetag
  const late = careRecurrence(start, '10:00', null, new Date('2026-10-23T11:30:00'))
  assert.equal(occursOn(late, day(23)), false)
  assert.equal(occursOn(late, day(24)), true)
  assert.equal(occursOn(late, new Date(2027, 2, 1)), true)
  // Start in der Zukunft bleibt unverändert
  const future = careRecurrence(new Date('2026-11-02T00:00:00'), '07:30', null, new Date('2026-10-23T11:30:00'))
  assert.equal(future.startDate.getDate(), 2)
  assert.equal(occursOn(future, day(31)), false)
})

test('Therapie: Woche beginnt am Montag, Rückstand erst wenn Soll unerreichbar', () => {
  const thu = new Date('2026-10-22T10:00:00')
  assert.equal(weekStart(thu).getDay(), 1)
  const mon = new Date('2026-10-19T09:00:00')
  assert.deepEqual(weekProgress(2, [mon], thu), { done: 1, target: 2, behind: false })
  const sun = new Date('2026-10-25T18:00:00')
  assert.equal(weekProgress(3, [mon], sun).behind, true)
  assert.equal(weekProgress(2, [new Date('2026-10-16T09:00:00')], thu).done, 0) // Vorwoche zählt nicht
})

test('Therapie: Evaluation fällig nur bei aktiven Plänen', () => {
  const now = new Date('2026-10-23T10:00:00')
  assert.equal(reviewDue({ status: 'active', reviewAt: new Date('2026-10-23T00:00:00') }, now), true)
  assert.equal(reviewDue({ status: 'active', reviewAt: new Date('2026-11-01T00:00:00') }, now), false)
  assert.equal(reviewDue({ status: 'completed', reviewAt: new Date('2026-10-01T00:00:00') }, now), false)
})

test('Therapie: Plan und Einheit validieren', () => {
  const ok = planSchema.safeParse({ residentId: 'r1', discipline: 'physio', goal: 'Gehstrecke 50 m mit Rollator', perWeek: '2', sessionMin: '30', startDate: '2026-10-23', reviewAt: '2026-11-20', endDate: '', careInstructions: '', careTime: '', orderId: '' })
  assert.equal(ok.success, true)
  const bad = planSchema.safeParse({ residentId: 'r1', discipline: 'yoga', goal: 'x', perWeek: '0', sessionMin: '5', startDate: '2026-10-23', reviewAt: '', endDate: '', careInstructions: '', careTime: '', orderId: '' })
  assert.equal(bad.success, false)
  assert.equal(sessionSchema.safeParse({ planId: 'p', appointmentId: '', outcome: 'done', durationMin: '30', text: '' }).success, false)
  assert.equal(sessionSchema.safeParse({ planId: 'p', appointmentId: '', outcome: 'refused', durationMin: '0', text: '' }).success, true)
  assert.equal(sessionSchema.safeParse({ planId: 'p', appointmentId: '', outcome: 'done', durationMin: '30', text: 'Gangschule 40 m' }).success, true)
})
