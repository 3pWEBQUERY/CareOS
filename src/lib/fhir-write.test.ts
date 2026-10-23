import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFhirVital } from './fhir-write'

const now = new Date('2026-10-22T12:00:00+02:00')
const base = { resourceType: 'Observation', status: 'final', subject: { reference: 'Patient/abc' }, effectiveDateTime: '2026-10-22T10:15:00+02:00' }

test('FHIR schreibend: Einzelwert Temperatur', () => {
  const r = parseFhirVital({ ...base, code: { coding: [{ system: 'http://loinc.org', code: '8310-5' }] }, valueQuantity: { value: 38.14, unit: '°C', system: 'http://unitsofmeasure.org', code: 'Cel' } }, now)
  assert.ok(!('error' in r))
  if (!('error' in r)) { assert.equal(r.residentId, 'abc'); assert.deepEqual(r.values, { temp: 38.1 }) }
})

test('FHIR schreibend: Blutdruck-Panel und Umrechnung mg/dL', () => {
  const bp = parseFhirVital({ ...base, code: { coding: [{ code: '85354-9' }] }, component: [
    { code: { coding: [{ code: '8480-6' }] }, valueQuantity: { value: 142, code: 'mm[Hg]' } },
    { code: { coding: [{ code: '8462-4' }] }, valueQuantity: { value: 86, code: 'mm[Hg]' } },
  ] }, now)
  assert.deepEqual('error' in bp ? bp : bp.values, { sys: 142, dia: 86 })
  const bz = parseFhirVital({ ...base, code: { coding: [{ code: '2339-0' }] }, valueQuantity: { value: 180, code: 'mg/dL' } }, now)
  assert.deepEqual('error' in bz ? bz : bz.values, { glucose: 10 })
})

test('FHIR schreibend: verständliche Fehler', () => {
  const e = (x: unknown) => { const r = parseFhirVital(x, now); return 'error' in r ? r.error : '' }
  assert.match(e({ ...base, status: 'preliminary' }), /status/)
  assert.match(e({ ...base, effectiveDateTime: '2026-10-22T10:15:00' }), /time zone/)
  assert.match(e({ ...base, code: { coding: [{ code: '8310-5' }] }, valueQuantity: { value: 100.4, code: '[degF]' } }), /unit/)
  assert.match(e({ ...base, code: { coding: [{ code: '59408-5' }] }, valueQuantity: { value: 45, code: '%' } }), /plausible/)
  assert.match(e({ ...base, code: { coding: [{ code: '8480-6' }] }, valueQuantity: { value: 120, code: 'mm[Hg]' } }), /panel/)
  assert.match(e({ ...base, effectiveDateTime: '2026-10-23T10:15:00+02:00', code: { coding: [{ code: '8310-5' }] }, valueQuantity: { value: 37, code: 'Cel' } }), /future/)
})

test('FHIR AllergyIntolerance schreibend: Prüfung', async () => {
  const { parseFhirAllergy } = await import('./fhir-write')
  const ok = parseFhirAllergy({ resourceType: 'AllergyIntolerance', patient: { reference: 'Patient/abc1' }, code: { coding: [{ system: 'http://snomed.info/sct', code: '91936005', display: 'Penicillin' }] } })
  assert.deepEqual(ok, { residentId: 'abc1', text: 'Penicillin' })
  assert.match((parseFhirAllergy({ resourceType: 'AllergyIntolerance', patient: { reference: 'Patient/a' }, code: { text: 'Latex' }, clinicalStatus: { coding: [{ code: 'resolved' }] } }) as { error: string }).error, /only clinicalStatus active/)
  assert.match((parseFhirAllergy({ resourceType: 'AllergyIntolerance', patient: { reference: 'x' }, code: { text: 'Latex' } }) as { error: string }).error, /patient.reference/)
  assert.match((parseFhirAllergy({ resourceType: 'Observation' }) as { error: string }).error, /resourceType/)
})
