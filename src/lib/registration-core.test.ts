import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashCode, newRegistrationCode, normalizeCode, orgSignupSchema, readRegistration, registrationSchema } from './registration-core'

const valid = { code: 'abcd-efgh-jkmn', firstName: ' Anna ', lastName: 'Muster', email: ' Anna.Muster@Example.CH ', password: 'langes-passwort-1', note: '', consent: 'on' }
const err = (r: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) => r.error?.issues.map((i) => `${String(i.path[0])}:${i.message}`) ?? []

test('Registrierungscode: Format, Normalisierung, Hash unabhängig von Schreibweise', () => {
  const c = newRegistrationCode()
  assert.match(c, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  assert.notEqual(newRegistrationCode(), c)
  assert.equal(normalizeCode(' abcd efgh-jkmn '), 'ABCDEFGHJKMN')
  assert.equal(hashCode('abcd-efgh-jkmn'), hashCode('ABCDEFGHJKMN'))
  assert.notEqual(hashCode('ABCDEFGHJKMN'), hashCode('ABCDEFGHJKMP'))
})

test('Einstellungen: aktiv nur mit Code', () => {
  assert.deepEqual(readRegistration({}), { enabled: false, codeHash: null, codeEnc: null, rotatedAt: null })
  assert.equal(readRegistration({ registration: { enabled: true } }).enabled, false)
  assert.equal(readRegistration({ registration: { enabled: true, codeHash: 'h', codeEnc: 'e' } }).enabled, true)
})

test('Konto beantragen: gültige Eingabe wird normalisiert', () => {
  const r = registrationSchema.safeParse(valid)
  assert.ok(r.success)
  assert.equal(r.data.code, 'ABCDEFGHJKMN')
  assert.equal(r.data.firstName, 'Anna')
  assert.equal(r.data.email, 'anna.muster@example.ch')
  assert.equal(r.data.note, null)
})

test('Konto beantragen: Fehler am richtigen Feld', () => {
  assert.deepEqual(err(registrationSchema.safeParse({ ...valid, code: 'ABC' })), ['code:register.errors.code'])
  assert.deepEqual(err(registrationSchema.safeParse({ ...valid, email: 'keine-mail' })), ['email:register.errors.email'])
  assert.deepEqual(err(registrationSchema.safeParse({ ...valid, firstName: '  ' })), ['firstName:register.errors.firstName'])
  assert.deepEqual(err(registrationSchema.safeParse({ ...valid, password: 'kurz-1' })), ['password:register.errors.passwordLength'])
  assert.deepEqual(err(registrationSchema.safeParse({ ...valid, password: '123456789012345' })), ['password:register.errors.passwordDigits'])
  assert.deepEqual(err(registrationSchema.safeParse({ ...valid, password: 'elf-zeichen' })), ['password:register.errors.passwordLength'])
  assert.deepEqual(err(registrationSchema.safeParse({ ...valid, consent: undefined })), ['consent:register.errors.consent'])
  assert.deepEqual(err(registrationSchema.safeParse({ ...valid, note: 'x'.repeat(121) })), ['note:register.errors.note'])
})

test('Neue Organisation: Name erforderlich', () => {
  const base = { orgName: 'Alterszentrum Muster', firstName: 'A', lastName: 'B', email: 'a@b.ch', password: 'langes-passwort-1', consent: 'on' }
  assert.ok(orgSignupSchema.safeParse(base).success)
  assert.deepEqual(err(orgSignupSchema.safeParse({ ...base, orgName: 'X' })), ['orgName:register.errors.orgName'])
})
