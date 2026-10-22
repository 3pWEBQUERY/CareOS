import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateResidents, generateStaff, makeRng, mailPart, planStaff, roomNumber, uniqueInitials } from './people'
import { ELDER_FIRST, STAFF_FIRST } from './names'

const today = new Date(2026, 9, 22, 12)

test('Bewohnende: Anzahl, eindeutige Namen, gleichmässig verteilt, eigene Zimmer', () => {
  const r = generateResidents(100, { units: 4, rng: makeRng('t1'), today })
  assert.equal(r.length, 100)
  assert.equal(new Set(r.map((p) => p.firstName + ' ' + p.lastName)).size, 100)
  const perUnit = [0, 1, 2, 3].map((u) => r.filter((p) => p.unitIndex === u).length)
  assert.deepEqual(perUnit, [25, 25, 25, 25])
  assert.equal(new Set(r.map((p) => p.unitIndex + ':' + p.room)).size, 100)
  assert.ok(r.filter((p) => p.unitIndex === 1).every((p) => /^2(0[1-9]|1\d|2[0-5])$/.test(p.room)))
  // ungleichmässig teilbar: höchstens 1 Unterschied
  const odd = generateResidents(10, { units: 3, rng: makeRng('t2'), today })
  const counts = [0, 1, 2].map((u) => odd.filter((p) => p.unitIndex === u).length)
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1)
})

test('Bewohnende: Geburtsdatum 1925–1952, Eintritt in den letzten 5 Jahren, Pflegestufe 1–12, Geschlecht passt zum Vornamen', () => {
  const r = generateResidents(500, { units: 5, rng: makeRng('t3'), today })
  const fiveYears = new Date(2021, 9, 22)
  for (const p of r) {
    assert.ok(p.birthDate >= new Date(1925, 0, 1) && p.birthDate <= new Date(1952, 11, 31), String(p.birthDate))
    assert.equal(p.birthDate.getHours(), 0)
    assert.ok(p.admittedAt >= fiveYears && p.admittedAt < new Date(2026, 9, 22), String(p.admittedAt))
    assert.ok(Number.isInteger(p.careLevel) && p.careLevel >= 1 && p.careLevel <= 12)
    assert.ok(ELDER_FIRST[p.sex].includes(p.firstName), p.firstName)
    assert.ok(!ELDER_FIRST[p.sex === 'f' ? 'm' : 'f'].includes(p.firstName), p.firstName)
  }
  assert.ok(new Set(r.map((p) => p.careLevel)).size >= 8)
  assert.ok(r.some((p) => p.sex === 'm') && r.some((p) => p.sex === 'f'))
})

test('Zufall: mit Seed reproduzierbar, ohne Seed verschieden', () => {
  const a = generateResidents(30, { units: 2, rng: makeRng('x'), today })
  const b = generateResidents(30, { units: 2, rng: makeRng('x'), today })
  assert.deepEqual(a, b)
  const c = generateResidents(30, { units: 2, rng: makeRng(null), today })
  const d = generateResidents(30, { units: 2, rng: makeRng(null), today })
  assert.notDeepEqual(c.map((p) => p.lastName + p.firstName + p.birthDate.getTime()), d.map((p) => p.lastName + p.firstName + p.birthDate.getTime()))
})

test('Rollen-Mix: 15 Mitarbeitende auf 4 Wohngruppen', () => {
  const plan = planStaff(15, 4)
  const n = (k: string) => plan.filter((p) => p.kind === k).length
  assert.equal(plan.length, 15)
  assert.equal(n('director'), 1)
  assert.equal(n('lead'), 4)
  assert.deepEqual([n('rn'), n('fage'), n('aide')], [4, 3, 3])
  assert.deepEqual([0, 1, 2, 3].map((u) => plan.filter((p) => p.kind === 'lead' && p.unitIndex === u).length), [1, 1, 1, 1])
  assert.deepEqual([0, 1, 2, 3].map((u) => plan.filter((p) => p.kind === 'rn' && p.unitIndex === u).length), [1, 1, 1, 1])
  // wenige Personen: Leitungen nur, soweit Personal dafür da ist
  assert.deepEqual(planStaff(3, 4).map((p) => p.kind), ['director', 'rn', 'fage'])
  assert.equal(planStaff(0, 4).length, 0)
})

test('Mitarbeitende: eindeutige E-Mails und Kürzel, Platzhalter-Domain, Titel passend zum Geschlecht', () => {
  const s = generateStaff(60, { units: 4, rng: makeRng('s'), domain: 'example.ch', takenEmails: ['admin@example.ch'], takenInitials: ['SA'] })
  assert.equal(s.length, 60)
  assert.equal(new Set(s.map((p) => p.email)).size, 60)
  assert.equal(new Set(s.map((p) => p.initials)).size, 60)
  assert.ok(s.every((p) => /^[a-z0-9.-]+@example\.ch$/.test(p.email) && p.initials !== 'SA'))
  assert.ok(s.every((p) => STAFF_FIRST[p.sex].includes(p.firstName)))
  assert.ok(s.filter((p) => p.kind === 'rn').every((p) => p.jobTitle === (p.sex === 'f' ? 'Pflegefachfrau HF' : 'Pflegefachmann HF')))
  assert.equal(s[0].role, 'nursing_director')
})

test('Hilfsfunktionen', () => {
  assert.equal(mailPart('Céline'), 'celine')
  assert.equal(mailPart('Müller'), 'mueller')
  assert.equal(mailPart('Hans-Peter'), 'hans-peter')
  assert.equal(roomNumber(0, 0, 25), '101')
  assert.equal(roomNumber(3, 24, 25), '425')
  assert.equal(roomNumber(1, 4, 120), '2005')
  const taken = new Set<string>()
  assert.equal(uniqueInitials('Anna', 'Muster', taken), 'AM')
  assert.equal(uniqueInitials('Andrea', 'Meier', taken), 'AME')
  assert.equal(uniqueInitials('Adrian', 'Meier', taken), 'AM2')
})
