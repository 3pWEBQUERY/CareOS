import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  NEVER_SHARED, PORTAL_GRANTS, accessState, clampToConsent, effectiveGrants, isPhysicianContact, isShareableFileCategory, normalizeGrants, portalAppointment,
  portalFile, portalResident, portalSettings, residentVisible, threadStatusAfter, visitProblem, visitTransition,
} from './policy'

const base = { grants: ['appointments', 'messages', 'visits'], consentScope: ['appointments', 'messages', 'visits'], revokedAt: null, acceptedAt: new Date('2026-10-01'), accountId: 'acc1' }
const ok = { moduleOn: true, access: base, account: { lockedAt: null }, resident: { status: 'active', anonymisedAt: null } }

test('Freigaben: klinische Daten sind keine Freigabe und werden verworfen', () => {
  for (const n of NEVER_SHARED) assert.ok(!(PORTAL_GRANTS as readonly string[]).includes(n), n)
  assert.deepEqual(normalizeGrants(['vitals', 'medication', 'observations', 'careplan', 'messages', 'messages', 'diagnoses', 'appointments']), ['appointments', 'messages'])
  assert.deepEqual(normalizeGrants(null), [])
})

test('Freigaben liegen immer innerhalb der Einwilligung', () => {
  assert.deepEqual(clampToConsent(['appointments', 'files', 'updates'], ['appointments', 'updates']), ['appointments', 'updates'])
  assert.deepEqual(clampToConsent(['files'], []), [])
  assert.deepEqual(clampToConsent(['vitals', 'files'], ['vitals', 'files']), ['files'])
})

test('Wirksame Freigaben: Modul, Widerruf, Annahme, Sperre, Status der Person', () => {
  assert.deepEqual(effectiveGrants(ok), ['appointments', 'messages', 'visits'])
  assert.deepEqual(effectiveGrants({ ...ok, moduleOn: false }), [])
  assert.deepEqual(effectiveGrants({ ...ok, access: { ...base, revokedAt: new Date() } }), [])
  assert.deepEqual(effectiveGrants({ ...ok, access: { ...base, acceptedAt: null } }), [])
  assert.deepEqual(effectiveGrants({ ...ok, access: { ...base, accountId: null } }), [])
  assert.deepEqual(effectiveGrants({ ...ok, account: { lockedAt: new Date() } }), [])
  assert.deepEqual(effectiveGrants({ ...ok, account: null }), [])
  assert.deepEqual(effectiveGrants({ ...ok, resident: { status: 'discharged', anonymisedAt: null } }), [])
  assert.deepEqual(effectiveGrants({ ...ok, resident: { status: 'deceased', anonymisedAt: null } }), [])
  assert.deepEqual(effectiveGrants({ ...ok, resident: { status: 'active', anonymisedAt: new Date() } }), [])
  assert.equal(residentVisible({ status: 'absent', anonymisedAt: null }), true)
  // Freigabe ohne Einwilligung wirkt nicht
  assert.deepEqual(effectiveGrants({ ...ok, access: { ...base, grants: ['appointments', 'files'], consentScope: ['appointments'] } }), ['appointments'])
})

test('Projektion der Person: nur Name, Bereich, Zimmer – keine Gesundheitsdaten', () => {
  const full = {
    id: 'r1', firstName: 'Margrit', lastName: 'Huber', unit: { name: 'WG 2' }, room: { number: '12' },
    allergies: ['Penicillin'], risks: ['Sturz'], rea: 'no', diet: 'Diabetes', importantNotes: 'x', physician: 'Dr. X', careLevel: 8, birthDate: new Date('1940-01-01'), insuranceNo: '756.1',
  }
  const p = portalResident(full)
  assert.deepEqual(Object.keys(p).sort(), ['firstName', 'id', 'lastName', 'room', 'unit'])
  assert.equal(p.room, '12')
  assert.equal(portalResident({ ...full, room: null }).room, null)
})

test('Termine: Titel nur bei nicht klinischen Arten, nie Notizen', () => {
  const at = new Date('2026-11-02T10:00:00')
  const doc = portalAppointment({ id: 'a', at, kind: 'physician', title: 'Onkologie Kontrolle', place: 'Spital', done: false, ...{ notes: 'Befund besprechen' } } as never)
  assert.equal(doc.title, null)
  assert.equal(doc.kind, 'physician')
  assert.ok(!('notes' in doc))
  assert.equal(portalAppointment({ id: 'b', at, kind: 'hospital', title: 'Kardiologie', place: null, done: false }).title, null)
  assert.equal(portalAppointment({ id: 'c', at, kind: 'therapy', title: 'Logopädie Schluckstörung', place: null, done: false }).title, null)
  assert.equal(portalAppointment({ id: 'd', at, kind: 'relatives', title: 'Besuch Tochter', place: null, done: false }).title, 'Besuch Tochter')
  assert.equal(portalAppointment({ id: 'e', at, kind: 'weird', title: 'X', place: null, done: false }).kind, 'other')
})

test('Dateien: nur einzeln freigegeben und nur nicht klinische Kategorien', () => {
  const f = { id: 'f', title: 'Hausordnung', category: 'other', createdAt: new Date(), portalShared: true, file: { contentType: 'application/pdf', size: 1000 } }
  assert.deepEqual(Object.keys(portalFile(f)!).sort(), ['contentType', 'createdAt', 'id', 'size', 'title'])
  assert.equal(portalFile({ ...f, portalShared: false }), null)
  for (const c of ['report', 'lab', 'imaging', 'prescription']) {
    assert.equal(isShareableFileCategory(c), false, c)
    assert.equal(portalFile({ ...f, category: c }), null, c)
  }
  for (const c of ['directive', 'consent', 'insurance', 'other']) assert.equal(isShareableFileCategory(c), true, c)
})

test('Besuche: Zeitprüfung, Personen und erlaubte Übergänge', () => {
  const now = new Date('2026-10-23T10:00:00')
  const s = portalSettings({})
  const at = (h: string, day = '2026-10-25') => new Date(`${day}T${h}:00`)
  assert.equal(visitProblem({ start: at('14:00'), end: at('15:00'), visitors: 2 }, s, now), null)
  assert.equal(visitProblem({ start: at('15:00'), end: at('14:00'), visitors: 1 }, s, now), 'visitEnd')
  assert.equal(visitProblem({ start: at('08:00'), end: at('17:00'), visitors: 1 }, s, now), 'visitLong')
  assert.equal(visitProblem({ start: new Date('2026-10-23T11:00:00'), end: new Date('2026-10-23T12:00:00'), visitors: 1 }, s, now), 'visitSoon')
  assert.equal(visitProblem({ start: at('14:00', '2027-03-01'), end: at('15:00', '2027-03-01'), visitors: 1 }, s, now), 'visitFar')
  assert.equal(visitProblem({ start: at('14:00'), end: at('15:00'), visitors: 0 }, s, now), 'visitors')
  assert.equal(visitProblem({ start: at('14:00'), end: at('15:00'), visitors: 11 }, s, now), 'visitors')
  assert.equal(visitProblem({ start: new Date('x'), end: at('15:00'), visitors: 1 }, s, now), 'visitTime')
  assert.equal(visitTransition('requested', 'confirmed', 'staff'), true)
  assert.equal(visitTransition('requested', 'declined', 'staff'), true)
  assert.equal(visitTransition('confirmed', 'declined', 'staff'), false)
  assert.equal(visitTransition('requested', 'confirmed', 'family'), false)
  assert.equal(visitTransition('confirmed', 'cancelled', 'family'), true)
  assert.equal(visitTransition('declined', 'cancelled', 'family'), false)
  assert.equal(threadStatusAfter('family'), 'open')
  assert.equal(threadStatusAfter('staff'), 'answered')
})

test('Zustand eines Zugangs und Einstellungen', () => {
  const now = new Date('2026-10-23T10:00:00')
  const later = new Date('2026-10-30T10:00:00')
  assert.equal(accessState({ revokedAt: null, acceptedAt: null, inviteExpiresAt: later }, null, now), 'invited')
  assert.equal(accessState({ revokedAt: null, acceptedAt: null, inviteExpiresAt: new Date('2026-10-22') }, null, now), 'expired')
  assert.equal(accessState({ revokedAt: null, acceptedAt: now, inviteExpiresAt: null }, { lockedAt: null }, now), 'active')
  assert.equal(accessState({ revokedAt: null, acceptedAt: now, inviteExpiresAt: null }, { lockedAt: now }, now), 'locked')
  assert.equal(accessState({ revokedAt: now, acceptedAt: now, inviteExpiresAt: null }, { lockedAt: null }, now), 'revoked')
  const s = portalSettings({ portal: { defaultGrants: ['vitals', 'files'], visitLeadHours: 500, visitMaxDays: 'x' } })
  assert.deepEqual(s.defaultGrants, ['files'])
  assert.equal(s.visitLeadHours, 72)
  assert.equal(s.visitMaxDays, 60)
  assert.deepEqual(portalSettings(null).defaultGrants, ['appointments', 'updates', 'messages', 'visits'])
})

// ───────── Struktur: Portal-Code fragt nie klinische Tabellen ab und nutzt nie die Sitzung der Mitarbeitenden ─────────

const ROOT = join(__dirname, '..', '..', '..')
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts') ? [p] : []
  })
}
const PORTAL_CODE = [...files(join(ROOT, 'src/lib/portal')), ...files(join(ROOT, 'src/app/portal'))]

test('Portal-Code liest keine klinischen Tabellen', () => {
  const clinical = /\b(?:db|tx)\.(vitalSign|vitalThreshold|medication|medicationAdministration|observation|carePlan|carePlanArea|intervention|assessment|wound|woundAssessment|nutritionProfile|intakeLog|task|handover|handoverEntry|incident|labResult|visit|visitQuestion|visitOrder|careEpisode)\.(find|count|aggregate|groupBy)/
  assert.ok(PORTAL_CODE.length > 10)
  for (const f of PORTAL_CODE) assert.ok(!clinical.test(readFileSync(f, 'utf8')), f)
})

test('Sitzungs-Trennung: Portal nutzt nie getCtx/getSession der Stationsapp', () => {
  for (const f of PORTAL_CODE) {
    const src = readFileSync(f, 'utf8')
    // nur Typen erlaubt (Team-Helfer in manage.ts erhalten den Kontext der Stationsapp als Parameter)
    assert.ok(!/^import (?!type )[^\n]*from '@\/lib\/context'/m.test(src), f + ' importiert getCtx')
    assert.ok(!/\b(getSession|requireSession|createSession|destroySession|SESSION_COOKIE)\b/.test(src), f + ' nutzt die Sitzung der Mitarbeitenden')
    assert.ok(!/careos_session/.test(src) || f.endsWith('routing.ts'), f)
  }
  const staff = readFileSync(join(ROOT, 'src/lib/auth/session.ts'), 'utf8')
  assert.ok(!/portal/i.test(staff), 'Stationsapp-Sitzung kennt das Portal nicht')
})

test('Einladung: ärztliche Kontaktpersonen erhalten keinen Portalzugang (Ärzteportal)', () => {
  for (const r of ['Hausarzt', 'Hausärztin', 'Zahnarzt', 'Ärztin', 'Dr. med.', 'médecin traitant', 'Médecin', 'medico curante', 'Medica di base', 'Dottoressa', 'GP', 'Physician', 'family doctor'])
    assert.ok(isPhysicianContact(r), r)
  for (const r of ['Tochter', 'Sohn', 'Beistand', 'Ehemann', 'fille', 'curateur', 'figlia', 'curatore', 'daughter', 'guardian', 'Nachbarin', '', null])
    assert.ok(!isPhysicianContact(r), String(r))
})
