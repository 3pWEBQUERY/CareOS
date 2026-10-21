import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasPermission, DEFAULT_ROLES, ALL_PERMISSIONS } from './permissions'
import { format, makeT, defineMessages } from '../i18n/core'
import { flag, mergeLimits, abnormalKeys } from './vitals'
import { shiftAt, shiftBounds, inWindow, dbDate, fromDbDate, age } from './time'
import { ASSESSMENTS, scoreAssessment } from './clinical-config'

test('Berechtigung mit Geltungsbereich', () => {
  const grants = [{ permissions: ['resident.read'], locationId: null, unitId: 'u1' }]
  assert.equal(hasPermission(grants, 'resident.read', { unitId: 'u1' }), true)
  assert.equal(hasPermission(grants, 'resident.read', { unitId: 'u2' }), false)
  assert.equal(hasPermission(grants, 'resident.edit', { unitId: 'u1' }), false)
  const loc = [{ permissions: ['task.read'], locationId: 'l1', unitId: null }]
  assert.equal(hasPermission(loc, 'task.read', { unitId: 'x', locationId: 'l1' }), true)
  assert.equal(hasPermission(loc, 'task.read', { unitId: 'x', locationId: 'l2' }), false)
})

test('Abgabe und Verordnung sind getrennt (PRD §34)', () => {
  const nurse = DEFAULT_ROLES.find((r) => r.key === 'nurse')!
  assert.ok(nurse.permissions.includes('resident.medication.administer'))
  assert.ok(!nurse.permissions.includes('resident.medication.edit'))
  const admin = DEFAULT_ROLES.find((r) => r.key === 'sysadmin')!
  assert.equal(admin.permissions.length, ALL_PERMISSIONS.length)
})

test('Plural und Terminologie', () => {
  assert.equal(format('{n, plural, one {# {Resident}} other {# {Residents}}}', { n: 1, Resident: 'Patient/in', Residents: 'Patient/innen' }, 'de'), '1 Patient/in')
  const t = makeT({ a: { b: '{n, plural, one {# {resident}} other {# {residents}}}' } }, 'de', 'client')
  assert.equal(t('a.b', { n: 3 }), '3 Klient/innen')
  assert.equal(t('fehlt.ganz'), 'fehlt.ganz')
})

test('defineMessages liefert alle Sprachen', () => {
  const m = defineMessages({ de: { x: 'a' }, fr: { x: 'b' }, it: { x: 'c' }, en: { x: 'd' } })
  assert.deepEqual(Object.keys(m).sort(), ['de', 'en', 'fr', 'it'])
})

test('Vitalwerte: individuelle Grenzwerte überschreiben Organisation', () => {
  const lim = mergeLimits([{ key: 'sys', lo: 100, hi: 150, residentId: null }, { key: 'sys', lo: 90, hi: 170, residentId: 'r1' }], 'r1')
  assert.equal(flag('sys', 160, lim), '')
  assert.equal(flag('sys', 175, lim), 'hi')
  assert.equal(flag('spo2', 89, lim), 'lo')
  assert.deepEqual(abnormalKeys({ temp: 38.1, spo2: 89, pulse: 80 }, lim), ['temp', 'spo2'])
})

test('Schichten über Mitternacht', () => {
  const shifts = [
    { code: 'F', name: 'Früh', start: '07:00', end: '15:30' },
    { code: 'S', name: 'Spät', start: '14:45', end: '23:00' },
    { code: 'N', name: 'Nacht', start: '22:45', end: '07:15' },
  ]
  const at = (h: number, m: number) => new Date(2026, 9, 21, h, m)
  assert.equal(shiftAt(shifts, at(3, 0))?.code, 'N')
  assert.equal(shiftAt(shifts, at(15, 0))?.code, 'S')
  assert.equal(shiftAt(shifts, at(22, 50))?.code, 'N')
  assert.equal(inWindow(60, '22:45', '07:15'), true)
  const b = shiftBounds(shifts[2], new Date(2026, 9, 21))
  assert.equal(b.end.getDate(), 22)
})

test('@db.Date Umrechnung und Alter', () => {
  const d = new Date(2026, 0, 31)
  assert.equal(fromDbDate(dbDate(d)).getTime(), d.getTime())
  assert.equal(age(new Date('1938-03-14T00:00:00Z'), new Date(2026, 2, 13)), 87)
  assert.equal(age(new Date('1938-03-14T00:00:00Z'), new Date(2026, 2, 14)), 88)
})

test('Braden-Skala Bewertung', () => {
  const braden = ASSESSMENTS.find((a) => a.key === 'braden')!
  const r = scoreAssessment(braden, { sensory: 2, moisture: 2, activity: 1, mobility: 2, nutrition: 3, friction: 2 })
  assert.equal(r.score, 12)
  assert.equal(r.level, 'crit')
})
