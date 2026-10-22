import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CERT_STAGES, DOC_STAGES, DUE_STAGES, GRACE_DAYS, daysUntil, latestCertificates, leadNotice, reminderPriority, reminderStage, renewalDue, shouldRemind,
} from './reminder-policy'

const d = (iso: string, time = '08:00') => new Date(`${iso}T${time}:00`)

test('Erinnerung: Kalendertage unabhängig von der Uhrzeit, auch über die Zeitumstellung', () => {
  assert.equal(daysUntil(d('2026-10-22', '23:59'), d('2026-10-22', '00:01')), 0)
  assert.equal(daysUntil(d('2026-10-23', '00:00'), d('2026-10-22', '23:59')), 1)
  assert.equal(daysUntil(d('2026-10-20'), d('2026-10-22')), -2)
  // 25.10.2026: Ende der Sommerzeit in Zürich (Tag mit 25 Stunden)
  assert.equal(daysUntil(d('2026-10-26'), d('2026-10-24')), 2)
  assert.equal(daysUntil(d('2027-03-29'), d('2027-03-27')), 2)
})

test('Erinnerung: fällige Stufe je Frist', () => {
  assert.equal(reminderStage(61, CERT_STAGES), null)
  assert.equal(reminderStage(60, CERT_STAGES), 60)
  assert.equal(reminderStage(45, CERT_STAGES), 60)
  assert.equal(reminderStage(30, CERT_STAGES), 30)
  assert.equal(reminderStage(8, CERT_STAGES), 30)
  assert.equal(reminderStage(7, CERT_STAGES), 7)
  assert.equal(reminderStage(1, CERT_STAGES), 7)
  assert.equal(reminderStage(0, CERT_STAGES), 0)
  assert.equal(reminderStage(-3, CERT_STAGES), 0)
  assert.equal(reminderStage(-GRACE_DAYS, CERT_STAGES), 0)
  assert.equal(reminderStage(-GRACE_DAYS - 1, CERT_STAGES), null, 'lange Abgelaufenes wird nicht mehr gemeldet')
  assert.equal(reminderStage(15, DUE_STAGES), null)
  assert.equal(reminderStage(14, DUE_STAGES), 14)
  assert.equal(reminderStage(2, DUE_STAGES), 3)
  assert.equal(reminderStage(31, DOC_STAGES), null)
  assert.equal(reminderStage(10, DOC_STAGES), 30)
})

test('Erinnerung: jede Stufe einmal, nach Ausfall nur die dringendste', () => {
  assert.equal(shouldRemind(60, []), true)
  assert.equal(shouldRemind(60, [60]), false)
  assert.equal(shouldRemind(30, [60]), true)
  assert.equal(shouldRemind(30, [30, 60]), false)
  assert.equal(shouldRemind(7, [60]), true)
  assert.equal(shouldRemind(30, [7]), false, 'nach einer dringenderen Meldung keine weniger dringende')
  assert.equal(shouldRemind(0, [7, 30, 60]), true)
  assert.equal(shouldRemind(null, []), false)
  // Simulation: täglicher Lauf über 70 Tage meldet genau 60, 30, 7, 0
  const expires = d('2026-12-31')
  const sent: number[] = []
  for (let i = 0; i < 80; i++) {
    const now = new Date(2026, 9, 22 + i, 6, 30)
    const s = reminderStage(daysUntil(expires, now), CERT_STAGES)
    if (shouldRemind(s, sent)) sent.push(s!)
  }
  assert.deepEqual(sent, [60, 30, 7, 0])
  // Job fällt vom 59. bis 5. Tag vorher aus: nur 60, dann 7, dann 0
  const sent2: number[] = []
  for (const left of [60, 5, 4, 0, -1]) {
    const s = reminderStage(left, CERT_STAGES)
    if (shouldRemind(s, sent2)) sent2.push(s!)
  }
  assert.deepEqual(sent2, [60, 7, 0])
})

test('Erinnerung: Leitung erhält Gegenstand einmal innerhalb von 30 Tagen und bei Ablauf', () => {
  assert.equal(leadNotice(60, []), false)
  assert.equal(leadNotice(30, [60]), true)
  assert.equal(leadNotice(7, [60, 30]), false)
  assert.equal(leadNotice(7, [60]), true, 'Stufe 30 verpasst → bei 7 nachholen')
  assert.equal(leadNotice(0, [60, 30, 7]), true)
  assert.equal(leadNotice(0, [0]), false)
})

test('Erinnerung: Priorität, Neuzuweisung vor Ablauf, neuestes Zertifikat', () => {
  assert.equal(reminderPriority(60), 'info')
  assert.equal(reminderPriority(30), 'info')
  assert.equal(reminderPriority(7), 'action')
  assert.equal(reminderPriority(0), 'action')
  const now = d('2026-10-22')
  assert.equal(renewalDue(d('2026-12-21'), now), true)
  assert.equal(renewalDue(d('2026-12-22'), now), false)
  assert.equal(renewalDue(d('2026-10-21'), now), false, 'abgelaufen: syncExpired öffnet die Schulung')
  assert.equal(renewalDue(null, now), false)
  const certs = [
    { id: 'a', userId: 'u1', courseId: 'c1', title: 'Hygiene', issuedAt: d('2025-01-01'), expiresAt: d('2026-01-01') },
    { id: 'b', userId: 'u1', courseId: 'c1', title: 'Hygiene', issuedAt: d('2026-01-02'), expiresAt: d('2027-01-02') },
    { id: 'c', userId: 'u2', courseId: 'c1', title: 'Hygiene', issuedAt: d('2025-01-01'), expiresAt: d('2026-01-01') },
    { id: 'd', userId: 'u1', courseId: null, title: 'BLS-AED ', issuedAt: d('2024-05-01'), expiresAt: d('2026-05-01') },
    { id: 'e', userId: 'u1', courseId: null, title: 'bls-aed', issuedAt: d('2026-05-01'), expiresAt: d('2028-05-01') },
  ]
  assert.deepEqual(latestCertificates(certs).map((c) => c.id).sort(), ['b', 'c', 'e'])
})
