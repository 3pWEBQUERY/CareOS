import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FORMS, asStructuredForm, fieldKey, fieldsChanged, formSummary, normalizeFields, readFields, structuredRows, structuredSnapshot, validateFormValues } from './forms'
import { ACK_DEFAULTS, ackSettings } from './acks'
import { isAdminGrant, mfaSetupAllowedPath, mfaSetupRequired } from './mfa-policy'
import { snippet } from './search-snippet'

const words = { yes: 'Ja', no: 'Nein' }
const sturz = DEFAULT_FORMS.find((f) => f.key === 'sturzprotokoll')!

test('Standardformulare sind gültig definiert', () => {
  for (const f of DEFAULT_FORMS) {
    const r = normalizeFields(f.fields)
    assert.ok(r.ok, f.key)
    assert.deepEqual(r.ok && r.fields, f.fields, f.key)
  }
})

test('Felddefinitionen: Schlüssel, Optionen, Bereiche', () => {
  assert.equal(fieldKey('Schmerz (NRS) – Ruhe'), 'schmerz_nrs_ruhe')
  assert.equal(fieldKey('Übelkeit/Erbrechen'), 'uebelkeit_erbrechen')
  const r = normalizeFields([
    { label: 'Ort', type: 'select', options: 'Zimmer\nBad\n\nZimmer' },
    { label: 'Ort', type: 'text', unit: 'm' },
  ])
  assert.ok(r.ok)
  if (r.ok) {
    assert.deepEqual(r.fields[0].options, ['Zimmer', 'Bad'])
    assert.notEqual(r.fields[0].key, r.fields[1].key, 'doppelte Schlüssel werden eindeutig')
    assert.equal(r.fields[1].unit, 'm')
  }
  assert.deepEqual(normalizeFields([]), { ok: false, error: 'forms.errors.noFields' })
  assert.equal((normalizeFields([{ label: 'A', type: 'select', options: 'nur eins' }]) as { error: string }).error, 'forms.errors.options')
  assert.equal((normalizeFields([{ label: 'A', type: 'number', min: 5, max: 1 }]) as { error: string }).error, 'forms.errors.range')
  assert.equal((normalizeFields([{ label: 'A', type: 'scale', min: 0 }]) as { error: string }).error, 'forms.errors.scaleRange')
  assert.equal((normalizeFields([{ label: '', type: 'text' }]) as { index: number }).index, 0)
  assert.equal((normalizeFields([{ label: 'X', type: 'html' }]) as { error: string }).error, 'forms.errors.type')
  assert.deepEqual(readFields('kaputt'), [])
})

test('Eingaben validieren: Pflicht, Min/Max, Auswahl, Datum, Uhrzeit', () => {
  const bad = validateFormValues(sturz.fields, { ort: 'Keller', uhrzeit: '25:00', schmerz: '11', verletzungen: ['Hämatom', 'Unbekannt'] })
  assert.equal(bad.ok, false)
  assert.equal(bad.errors.ort, 'option')
  assert.equal(bad.errors.uhrzeit, 'time')
  assert.equal(bad.errors.aufgefunden, 'required')
  assert.equal(bad.errors.schmerz, 'max')
  assert.equal(bad.errors.verletzungen, 'option')

  const ok = validateFormValues(sturz.fields, { ort: 'Zimmer', uhrzeit: '06:40', aufgefunden: ' Am Boden neben dem Bett ', schmerz: '3', verletzungen: ['Schürfung', 'Hämatom'], arzt: true })
  assert.equal(ok.ok, true)
  assert.equal(ok.values.schmerz, 3)
  assert.equal(ok.values.aufgefunden, 'Am Boden neben dem Bett')
  assert.deepEqual(ok.values.verletzungen, ['Hämatom', 'Schürfung'], 'Reihenfolge wie definiert')
  assert.equal(ok.values.arzt, true)
  assert.equal('massnahmen' in ok.values, false, 'leere optionale Felder entfallen')

  const bilanz = DEFAULT_FORMS.find((f) => f.key === 'ausscheidung')!
  const b = validateFormValues(bilanz.fields, { urin: '350,5', stuhl: '8', einfuhr: '-1' })
  assert.equal(b.errors.stuhl, 'max')
  assert.equal(b.errors.einfuhr, 'min')
  assert.equal(b.errors.urin, undefined)
  assert.equal(validateFormValues(bilanz.fields, { stuhl: '2.5' }).errors.stuhl, 'number', 'Skala nur ganzzahlig')
  assert.equal(validateFormValues([{ key: 'd', label: 'D', type: 'date', required: true }], { d: '2026-13-40' }).errors.d, 'date')
  assert.equal(validateFormValues([{ key: 'c', label: 'C', type: 'checkbox', required: true }], {}).errors.c, 'required')
})

test('Zusammenfassung und Momentaufnahme', () => {
  const v = validateFormValues(sturz.fields, { ort: 'Badezimmer', uhrzeit: '06:40', aufgefunden: 'Sitzend\nam Boden', schmerz: '4', arzt: false })
  assert.ok(v.ok)
  assert.equal(
    formSummary(sturz.name, sturz.fields, v.values, words),
    'Sturzprotokoll: Ort: Badezimmer; Uhrzeit: 06:40; Aufgefunden wie: Sitzend am Boden; Schmerz (NRS): 4; Arzt informiert: Nein.',
  )
  const bilanz = DEFAULT_FORMS.find((f) => f.key === 'ausscheidung')!
  assert.equal(formSummary(bilanz.name, bilanz.fields, { urin: 350.5, erbrechen: true }, words), 'Ausscheidung/Bilanz: Urin: 350,5 ml; Erbrechen: Ja.')
  assert.equal(formSummary('Leer', [], {}, words), 'Leer.')

  const snap = structuredSnapshot({ key: sturz.key, version: 2, name: sturz.name }, sturz.fields, v.values)
  assert.equal(snap.formVersion, 2)
  assert.equal(snap.labels.schmerz, 'Schmerz (NRS)')
  assert.deepEqual(snap.order, sturz.fields.map((f) => f.key))
  // jsonb sortiert Schlüssel um: Anzeige folgt trotzdem der Feldreihenfolge
  const shuffled = JSON.parse(JSON.stringify({ ...snap, labels: Object.fromEntries(Object.entries(snap.labels).reverse()) }))
  const s = asStructuredForm(shuffled)!
  assert.deepEqual(structuredRows(s, words).map((r) => r.key), ['ort', 'uhrzeit', 'aufgefunden', 'schmerz', 'arzt'])
  assert.equal(structuredRows(s, words).find((r) => r.key === 'arzt')?.value, 'Nein')
  assert.equal(asStructuredForm({ correctionReason: 'x' }), null)
  assert.equal(fieldsChanged(sturz.fields, [...sturz.fields]), false)
  assert.equal(fieldsChanged(sturz.fields, sturz.fields.slice(1)), true)
})

test('Bestätigungen: Standardwerte und tolerantes Lesen', () => {
  assert.deepEqual(ackSettings(null), ACK_DEFAULTS)
  assert.deepEqual(ackSettings({ acks: 'x' }), ACK_DEFAULTS)
  const s = ackSettings({ acks: { handoverImportantRequiresAck: false, residentImportantNoteRequiresAck: true, criticalDocsReAck: 'nein' } })
  assert.equal(s.handoverImportantRequiresAck, false)
  assert.equal(s.residentImportantNoteRequiresAck, true)
  assert.equal(s.criticalDocsReAck, true, 'ungültige Werte → Standard')
  assert.equal(s.postsRequireAckDefault, false)
})

test('MFA-Pflicht: Entscheidung', () => {
  const base = { isAdmin: false, mfaEnabled: false, passkeys: 0, method: 'password' }
  assert.equal(mfaSetupRequired({ ...base, settings: {} }), false)
  assert.equal(mfaSetupRequired({ ...base, settings: { requireMfaForAdmins: true } }), false, 'nur Admins betroffen')
  assert.equal(mfaSetupRequired({ ...base, isAdmin: true, settings: { requireMfaForAdmins: true } }), true)
  assert.equal(mfaSetupRequired({ ...base, settings: { requireMfaForAll: true } }), true)
  assert.equal(mfaSetupRequired({ ...base, settings: { requireMfaForAll: true }, mfaEnabled: true }), false, 'TOTP erfüllt')
  assert.equal(mfaSetupRequired({ ...base, settings: { requireMfaForAll: true }, passkeys: 1 }), false, 'Passkey erfüllt')
  assert.equal(mfaSetupRequired({ ...base, settings: { requireMfaForAll: true }, method: 'sso' }), false, 'SSO ausgenommen')
  assert.equal(mfaSetupRequired({ ...base, settings: { requireMfaForAll: 'true' } }), false, 'nur echtes true')
  assert.equal(isAdminGrant(['resident.read', 'admin.audit']), true)
  assert.equal(isAdminGrant(['resident.read']), false)
  assert.equal(mfaSetupAllowedPath('/profile'), true)
  assert.equal(mfaSetupAllowedPath('/profiles'), false)
  assert.equal(mfaSetupAllowedPath('/admin'), false)
})

test('Suche: Textausschnitt um den Treffer', () => {
  assert.equal(snippet('kurz', 'x'), 'kurz')
  const long = 'A'.repeat(100) + ' Sturzprotokoll ausfüllen ' + 'B'.repeat(100)
  const s = snippet(long, 'sturzprotokoll', 40)
  assert.ok(s.includes('Sturzprotokoll'))
  assert.ok(s.startsWith('…') && s.endsWith('…'))
  assert.ok(snippet('x'.repeat(200), 'nicht da', 20).endsWith('…'))
})
