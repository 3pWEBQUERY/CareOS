import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isClinicalNotification, normalizePriorities, pushText } from './push-shared'
import { makeT } from '../i18n/core'
import common from '../i18n/messages/common'

const t = makeT({ common: common.de }, 'de', 'resident')

test('Push: klinische Benachrichtigungen ohne Inhalt', () => {
  assert.equal(isClinicalNotification('vitals.abnormal', '/residents/r1/vitals'), true)
  assert.equal(isClinicalNotification('incident', '/quality/i1'), true)
  assert.equal(isClinicalNotification('unbekannt'), true)
  assert.equal(isClinicalNotification('chat', '/residents/r1'), true)
  assert.equal(isClinicalNotification('schedule', '/schedule'), false)
  assert.equal(isClinicalNotification('chat', '/chat?c=1'), false)
  const crit = pushText(t, { priority: 'critical', kind: 'vitals.abnormal', title: 'Abweichende Vitalwerte: Muster Anna · 12', href: '/residents/r1/vitals', unit: 'Wohngruppe 2' })
  assert.equal(crit.title, 'Kritische Meldung in Wohngruppe 2')
  assert.ok(!crit.body.includes('Muster'))
  assert.equal(pushText(t, { priority: 'action', kind: 'careplan.review', title: 'Pflegeplanung prüfen: Muster', href: '/residents/r1/careplan' }).title, 'Aktion erforderlich')
  const sched = pushText(t, { priority: 'info', kind: 'schedule', title: 'Dienstplan veröffentlicht', href: '/schedule' })
  assert.equal(sched.title, 'Dienstplan veröffentlicht')
})

test('Push: Prioritäten normalisieren', () => {
  assert.deepEqual(normalizePriorities(['social', 'critical', 'x']), ['critical', 'social'])
  assert.deepEqual(normalizePriorities('critical'), [])
})
