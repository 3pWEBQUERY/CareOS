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

test('FHIR DocumentReference schreibend: Austrittsbericht als PDF', async () => {
  const { parseFhirDocumentReference } = await import('./fhir-write')
  const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n').toString('base64')
  const doc = {
    resourceType: 'DocumentReference', status: 'current', subject: { reference: 'Patient/abc1' }, date: '2026-10-22T10:30:00+02:00',
    type: { coding: [{ system: 'http://loinc.org', code: '18842-5', display: 'Discharge summary' }] },
    content: [{ attachment: { contentType: 'application/pdf', title: 'Austrittsbericht: Kantonsspital / Medizin', data: pdf } }],
  }
  const r = parseFhirDocumentReference(doc, 1024, now)
  assert.ok(!('error' in r))
  if (!('error' in r)) {
    assert.equal(r.residentId, 'abc1')
    assert.equal(r.kind, 'discharge')
    assert.equal(r.title, 'Austrittsbericht: Kantonsspital / Medizin')
    assert.equal(r.filename, 'Austrittsbericht Kantonsspital Medizin.pdf')
    assert.equal(r.date.toISOString(), '2026-10-22T08:30:00.000Z')
    assert.equal(Buffer.from(r.bytes).toString('latin1').slice(0, 5), '%PDF-')
  }
  // anderer Typ → Klinikbericht, Datum aus attachment.creation, Titel aus description
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')
  const c = parseFhirDocumentReference({ ...doc, date: undefined, description: 'Bericht Kardiologie', type: { text: 'Konsiliarbericht' }, content: [{ attachment: { contentType: 'image/png', creation: '2026-10-21', data: png } }] }, 1024, now)
  assert.deepEqual('error' in c ? c : [c.kind, c.title, c.filename], ['clinic', 'Bericht Kardiologie', 'Bericht Kardiologie.png'])
})

test('FHIR DocumentReference schreibend: verständliche Fehler', async () => {
  const { parseFhirDocumentReference } = await import('./fhir-write')
  const pdf = Buffer.from('%PDF-1.4 test').toString('base64')
  const base = { resourceType: 'DocumentReference', status: 'current', subject: { reference: 'Patient/a' }, date: '2026-10-22', type: { coding: [{ code: '11488-4' }] }, content: [{ attachment: { contentType: 'application/pdf', title: 'Bericht', data: pdf } }] }
  const e = (x: unknown, max = 1024) => { const r = parseFhirDocumentReference(x, max, now); return 'error' in r ? r.error : '' }
  assert.equal(e(base), '')
  assert.match(e({ ...base, status: 'superseded' }), /status/)
  assert.match(e({ ...base, subject: { reference: 'Group/1' } }), /subject/)
  assert.match(e({ ...base, type: undefined }), /type/)
  assert.match(e({ ...base, date: '2026-10-22T10:00:00' }), /ISO 8601/)
  assert.match(e({ ...base, date: '2026-10-23' }), /future/)
  assert.match(e({ ...base, content: [] }), /exactly one/)
  assert.match(e({ ...base, content: [{ attachment: { ...base.content[0].attachment, contentType: 'application/zip' } }] }), /contentType/)
  assert.match(e({ ...base, content: [{ attachment: { ...base.content[0].attachment, data: undefined } }] }), /base64/)
  assert.match(e({ ...base, content: [{ attachment: { ...base.content[0].attachment, data: '***' } }] }), /not valid base64/)
  assert.match(e({ ...base, content: [{ attachment: { ...base.content[0].attachment, contentType: 'image/jpeg' } }] }), /does not match/)
  assert.match(e(base, 4), /larger than/)
})
