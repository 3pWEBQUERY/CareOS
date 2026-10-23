import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultReviewDue, parseReviewDue, reviewDueForEscalation, reviewEscalationRecipients, reviewOverdue } from './docs-review'
import { DEFAULT_ESCALATION, escalationPolicy, visitQuestionDue } from './escalation-policy'

const now = new Date(2026, 9, 23, 10, 0)

test('Docs-Freigabe: Frist aus dem Datumsfeld (Ende des Tages, heute bis +90 Tage)', () => {
  assert.equal(defaultReviewDue(now), '2026-10-28')
  assert.deepEqual(parseReviewDue('2026-10-28', now), new Date(2026, 9, 28, 23, 59, 59))
  assert.deepEqual(parseReviewDue('2026-10-23', now), new Date(2026, 9, 23, 23, 59, 59))
  assert.equal(parseReviewDue('2026-10-22', now), null)
  assert.equal(parseReviewDue('2027-02-01', now), null)
  assert.equal(parseReviewDue('2026-02-30', now), null)
  assert.equal(parseReviewDue('', now), null)
})

test('Docs-Freigabe: Eskalation erst nach Fristablauf und nur einmal', () => {
  const v = { submittedAt: new Date(2026, 9, 20), approvedAt: null, reviewDueAt: new Date(2026, 9, 22, 23, 59, 59), reviewEscalatedAt: null }
  assert.ok(reviewOverdue(v, now))
  assert.ok(reviewDueForEscalation(v, now))
  assert.equal(reviewDueForEscalation({ ...v, reviewEscalatedAt: new Date(2026, 9, 23, 9) }, now), false)
  assert.equal(reviewDueForEscalation({ ...v, approvedAt: new Date(2026, 9, 22) }, now), false)
  assert.equal(reviewDueForEscalation({ ...v, submittedAt: null }, now), false)
  assert.equal(reviewDueForEscalation({ ...v, reviewDueAt: new Date(2026, 9, 23, 23, 59, 59) }, now), false)
  assert.equal(reviewDueForEscalation({ ...v, reviewDueAt: null }, now), false)
})

test('Docs-Freigabe: Empfangende der Eskalation', () => {
  // zugewiesen: übrige Freigabeberechtigte, nie die einreichende Person
  assert.deepEqual(reviewEscalationRecipients({ reviewerId: 'r', authorId: 'a', approvers: ['r', 'a', 'x', 'y'], leads: ['l'] }), ['x', 'y'])
  // keine weiteren Freigabeberechtigten: Leitung (ohne zugewiesene Person), auch wenn sie selbst eingereicht hat
  assert.deepEqual(reviewEscalationRecipients({ reviewerId: 'r', authorId: 'a', approvers: ['r', 'a'], leads: ['l', 'r', 'l'] }), ['l'])
  assert.deepEqual(reviewEscalationRecipients({ reviewerId: 'r', authorId: 'a', approvers: ['r', 'a'], leads: ['a'] }), ['a'])
  // niemand sonst: erneut die zugewiesene Person
  assert.deepEqual(reviewEscalationRecipients({ reviewerId: 'r', authorId: 'a', approvers: ['r'], leads: ['r'] }), ['r'])
  // ohne Zuweisung: alle Freigabeberechtigten erneut und die Leitung
  assert.deepEqual(reviewEscalationRecipients({ reviewerId: null, authorId: 'a', approvers: ['x', 'a'], leads: ['l', 'x'] }), ['x', 'l'])
})

test('Visitenfragen: Eskalation nach der Frist der Organisation, einmal je Frage', () => {
  const p = escalationPolicy({})
  assert.equal(p.visitQuestionHours, DEFAULT_ESCALATION.visitQuestionHours)
  assert.equal(escalationPolicy({ escalation: { visitQuestionHours: 1 } }).visitQuestionHours, 4)
  assert.equal(escalationPolicy({ escalation: { visitQuestionHours: 24 } }).visitQuestionHours, 24)
  const q = { status: 'open', createdAt: new Date(now.getTime() - 49 * 3600_000), escalatedAt: null }
  assert.ok(visitQuestionDue(q, p, now))
  assert.equal(visitQuestionDue({ ...q, createdAt: new Date(now.getTime() - 47 * 3600_000) }, p, now), false)
  assert.equal(visitQuestionDue({ ...q, escalatedAt: now }, p, now), false)
  assert.equal(visitQuestionDue({ ...q, status: 'answered' }, p, now), false)
  assert.equal(visitQuestionDue(q, { ...p, enabled: false }, now), false)
})
