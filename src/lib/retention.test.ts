import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RETENTION, RETENTION_RULES, anonymisedBirthDate, lastDailySlot, retentionCutoffs, retentionPolicy, subtractPeriod, zonedTime,
} from './retention-policy'
import { DEFAULT_ESCALATION, escalationPolicy, escalationWindow, overdueThreshold, shouldEscalateTask } from './escalation-policy'

test('Aufbewahrung: Standardwerte und Mindestwerte', () => {
  assert.deepEqual(retentionPolicy({}), DEFAULT_RETENTION)
  assert.equal(DEFAULT_RETENTION.clinical, 20)
  assert.equal(DEFAULT_RETENTION.audit, 10)
  const p = retentionPolicy({ retention: { clinical: 3, audit: 5, chat: '36', notifications: 'x', auto: false } })
  assert.equal(p.clinical, RETENTION_RULES.clinical.min) // nie unter 10 Jahre
  assert.equal(p.audit, 10)
  assert.equal(p.chat, 36)
  assert.equal(p.notifications, 90)
  assert.equal(p.auto, false)
  assert.equal(retentionPolicy({ retention: { clinical: 500 } }).clinical, RETENTION_RULES.clinical.max)
})

test('Aufbewahrung: Stichtage kalendergenau', () => {
  const now = new Date(2026, 9, 22, 14, 0)
  const c = retentionCutoffs(DEFAULT_RETENTION, now)
  assert.equal(c.clinical.getFullYear(), 2006)
  assert.equal(c.clinical.getMonth(), 9)
  assert.equal(c.clinical.getDate(), 22)
  assert.equal(c.chat.getFullYear(), 2024)
  assert.equal(c.ai.getFullYear(), 2025)
  assert.equal(c.notifications.getTime(), new Date(2026, 6, 24, 14, 0).getTime())
  assert.equal(c.audit.getFullYear(), 2016)
  // Monatsende und Schaltjahr werden gekürzt statt überzulaufen.
  assert.equal(subtractPeriod(new Date(2026, 2, 31), 1, 'months').getDate(), 28)
  assert.equal(subtractPeriod(new Date(2028, 1, 29), 1, 'years').getMonth(), 1)
  assert.equal(subtractPeriod(new Date(2028, 1, 29), 1, 'years').getDate(), 28)
})

test('Anonymisierung: Geburtsdatum nur Jahr', () => {
  const d = anonymisedBirthDate(new Date(Date.UTC(1938, 6, 14)))
  assert.equal(d.toISOString(), '1938-01-01T00:00:00.000Z')
})

test('Zeitplan: täglich 02:30 Europe/Zurich', () => {
  // Sommerzeit (UTC+2): 02:30 = 00:30 UTC
  assert.equal(zonedTime(2026, 7, 1, 2, 30, 'Europe/Zurich').toISOString(), '2026-07-01T00:30:00.000Z')
  // Winterzeit (UTC+1): 02:30 = 01:30 UTC
  assert.equal(zonedTime(2026, 12, 1, 2, 30, 'Europe/Zurich').toISOString(), '2026-12-01T01:30:00.000Z')
  // Vor 02:30 → Slot des Vortags, danach → heutiger Slot
  assert.equal(lastDailySlot(new Date('2026-12-01T01:00:00Z'), '02:30').toISOString(), '2026-11-30T01:30:00.000Z')
  assert.equal(lastDailySlot(new Date('2026-12-01T01:30:00Z'), '02:30').toISOString(), '2026-12-01T01:30:00.000Z')
  assert.equal(lastDailySlot(new Date('2026-07-01T23:59:00Z'), '02:30').toISOString(), '2026-07-01T00:30:00.000Z')
})

test('Eskalation: Schwellen und Auswahl', () => {
  const p = escalationPolicy({})
  assert.deepEqual(p, DEFAULT_ESCALATION)
  assert.equal(overdueThreshold('critical', p), 15)
  assert.equal(overdueThreshold('routine', p), 60)
  assert.equal(overdueThreshold('important', p), 60)
  const now = new Date('2026-10-22T10:00:00Z')
  const due = (min: number) => new Date(now.getTime() - min * 60_000)
  assert.equal(shouldEscalateTask({ status: 'planned', priority: 'critical', dueAt: due(20) }, p, now), true)
  assert.equal(shouldEscalateTask({ status: 'planned', priority: 'routine', dueAt: due(20) }, p, now), false)
  assert.equal(shouldEscalateTask({ status: 'planned', priority: 'routine', dueAt: due(61) }, p, now), true)
  assert.equal(shouldEscalateTask({ status: 'in_progress', priority: 'routine', dueAt: due(61) }, p, now), true)
  // Erledigte, bereits eskalierte und sehr alte Aufgaben nicht
  assert.equal(shouldEscalateTask({ status: 'done', priority: 'critical', dueAt: due(120) }, p, now), false)
  assert.equal(shouldEscalateTask({ status: 'escalated', priority: 'critical', dueAt: due(120) }, p, now), false)
  assert.equal(shouldEscalateTask({ status: 'planned', priority: 'critical', dueAt: due(25 * 60) }, p, now), false)
  // Ausgeschaltet
  assert.equal(shouldEscalateTask({ status: 'planned', priority: 'critical', dueAt: due(20) }, { ...p, enabled: false }, now), false)
  const w = escalationWindow(p, now)
  assert.equal(w.to.getTime(), due(15).getTime())
})

test('Eskalation: Einstellungen werden begrenzt', () => {
  const p = escalationPolicy({ escalation: { taskOverdueMinutes: 1, criticalTaskOverdueMinutes: 9999, taskNotifyRoles: ['ward_lead', 'ward_lead', 'x y', 3], enabled: false } })
  assert.equal(p.taskOverdueMinutes, 15)
  assert.equal(p.criticalTaskOverdueMinutes, 240)
  assert.deepEqual(p.taskNotifyRoles, ['ward_lead'])
  assert.equal(p.enabled, false)
  assert.deepEqual(p.incidentSevereNotifyRoles, ['nursing_director'])
})
