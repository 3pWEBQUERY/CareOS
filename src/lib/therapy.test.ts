import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSchema, reviewDue, sessionSchema, weekProgress, weekStart } from './therapy'

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
