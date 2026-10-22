import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryOf, normalizePrefs, selectRecipients, wantsInApp, wantsPush, type DutyState } from './notify-prefs'

const state = (p: Partial<Record<keyof DutyState, string[]>>): DutyState => ({
  onDutyUnit: new Set(p.onDutyUnit ?? []),
  onDutyNearby: new Set(p.onDutyNearby ?? []),
  planned: new Set(p.planned ?? []),
  absent: new Set(p.absent ?? []),
  leads: p.leads ?? [],
})

test('Empfänger: klinische Bereichsmeldung nur an Personen im Dienst und nicht geplante Leitung', () => {
  const s = state({ planned: ['anna', 'lea', 'tim'], onDutyUnit: ['anna'], leads: ['barbara'] })
  const r = selectRecipients(['anna', 'lea', 'tim', 'pdl'], s)
  assert.equal(r.mode, 'duty')
  assert.deepEqual(r.userIds.sort(), ['anna', 'pdl'])
})

test('Empfänger: Abwesende fallen weg, auch wenn nicht geplant', () => {
  const r = selectRecipients(['anna', 'pdl'], state({ planned: ['anna'], onDutyUnit: ['anna'], absent: ['pdl'] }))
  assert.deepEqual(r.userIds, ['anna'])
})

test('Empfänger: Stellvertretung im Standort, dann Leitung, dann alle', () => {
  const nearby = selectRecipients(['anna', 'lea', 'nacht'], state({ planned: ['anna', 'lea', 'nacht'], onDutyNearby: ['nacht'] }))
  assert.equal(nearby.mode, 'nearby')
  assert.deepEqual(nearby.userIds, ['nacht'])
  const leads = selectRecipients(['anna', 'lea'], state({ planned: ['anna', 'lea'], leads: ['barbara'] }))
  assert.equal(leads.mode, 'leads')
  assert.deepEqual(leads.userIds, ['barbara'])
  const all = selectRecipients(['anna', 'lea'], state({ planned: ['anna', 'lea'], absent: ['lea'] }))
  assert.equal(all.mode, 'all')
  assert.deepEqual(all.userIds, ['anna'])
  // Nie verlieren: auch wenn alle abwesend sind
  assert.deepEqual(selectRecipients(['anna', 'lea'], state({ planned: ['anna', 'lea'], absent: ['anna', 'lea'] })).userIds, ['anna', 'lea'])
})

test('Empfänger: ohne Dienstplanung und persönliche Meldungen unverändert', () => {
  assert.deepEqual(selectRecipients(['a', 'b', 'c'], state({})), { userIds: ['a', 'b', 'c'], mode: 'all' })
  assert.deepEqual(selectRecipients(['a'], state({ planned: ['a'] })), { userIds: ['a'], mode: 'personal' })
  assert.deepEqual(selectRecipients(['a', 'a'], state({ planned: ['a'] })), { userIds: ['a'], mode: 'personal' })
})

test('Arten und Einstellungen', () => {
  assert.equal(categoryOf('vitals.abnormal', '/residents/r1/vitals'), 'clinical')
  assert.equal(categoryOf('incident', '/quality/i1'), 'clinical')
  assert.equal(categoryOf('task', '/tasks?f=mine'), 'task')
  assert.equal(categoryOf('task.escalated', '/tasks'), 'clinical')
  assert.equal(categoryOf('schedule', '/schedule'), 'schedule')
  assert.equal(categoryOf('chat', '/chat?c=1'), 'chat')
  assert.equal(categoryOf('chat', '/residents/r1'), 'clinical')
  assert.equal(categoryOf('security', '/admin/security'), 'security')
  assert.equal(categoryOf('feedback', '/admin/usage'), 'other')
  const p = normalizePrefs({ kinds: { clinical: { app: false, push: false }, chat: { app: false } }, quietOffDuty: true })
  assert.equal(p.kinds.clinical.app, true) // gesperrt
  assert.equal(p.kinds.clinical.push, false)
  assert.equal(p.kinds.chat.app, false)
  assert.equal(p.kinds.chat.push, true)
  assert.equal(wantsInApp(p, 'chat', 'social'), false)
  assert.equal(wantsInApp(p, 'chat', 'critical'), true)
  assert.equal(wantsPush(p, 'chat', { planned: true, onDuty: false }), false)
  assert.equal(wantsPush(p, 'chat', { planned: true, onDuty: true }), true)
  assert.equal(wantsPush(p, 'chat', { planned: false, onDuty: false }), true)
  assert.deepEqual(normalizePrefs(null).kinds.team, { app: true, push: true })
})
