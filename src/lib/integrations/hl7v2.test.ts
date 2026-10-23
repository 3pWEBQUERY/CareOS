import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAck, Hl7Error, parseHl7, parseHl7Time, toAdtIntent } from './hl7v2'

/** PV1-Segment mit Feldern an ihrer Position (PV1-n). */
const pv1 = (f: Record<number, string>) => ['PV1', ...Array.from({ length: 45 }, (_, i) => f[i + 1] ?? '')].join('|').replace(/\|+$/, '')
const A01 = [
  'MSH|^~\\&|KIS|SPITAL|CAREOS|LINDENHOF|20261023101500||ADT^A01^ADT_A01|MSG00001|P|2.5',
  'EVN|A01|20261023101000',
  'PID|1||7561234567897^^^&2.16.756.5.32&ISO^SS~4711^^^KIS^MR||Muster^Erika^^^^^L||19380314|F|||Bahnhofstr. 1^^Zürich',
  pv1({ 2: 'I', 3: 'WG 1^101^1', 44: '20261023100000' }),
].join('\r')

test('HL7 v2: Segmente, Komponenten, AHV-Nr. als Versichertennummer', () => {
  const m = parseHl7(A01)
  assert.equal(m.get('MSH', 9, 1), 'ADT')
  assert.equal(m.get('MSH', 10), 'MSG00001')
  const i = toAdtIntent(m)
  assert.equal(i.event, 'A01')
  assert.equal(i.person.insuranceNo, '7561234567897')
  assert.deepEqual(i.person.ids, ['7561234567897', '4711'])
  assert.equal(i.person.lastName, 'Muster')
  assert.equal(i.person.firstName, 'Erika')
  assert.equal(i.person.birthDate, '1938-03-14')
  assert.equal(i.person.sex, 'f')
  assert.deepEqual(i.location, { unit: 'WG 1', room: '101' })
  assert.equal(i.admittedAt?.getHours(), 10)
})

test('HL7 v2: LF statt CR, Escape-Sequenzen, Zeitzone, verstorben (PV1-36 = 20)', () => {
  const msg = 'MSH|^~\\&|KIS||||202610231200+0100||ADT^A03|X2|P|2.5\nPID|||1||Meier\\T\\Co^Hans||19400101|M\n' + pv1({ 2: 'I', 3: 'WG 2^203', 36: '20' })
  const i = toAdtIntent(parseHl7(msg))
  assert.equal(i.event, 'A03')
  assert.equal(i.person.lastName, 'Meier&Co')
  assert.equal(i.person.deceased, true)
  assert.equal(parseHl7Time('202610231200+0100')?.toISOString(), '2026-10-23T11:00:00.000Z')
  assert.equal(parseHl7Time('20261332'), null)
})

test('HL7 v2: nicht unterstützte Nachrichten und Quittung', () => {
  assert.throws(() => toAdtIntent(parseHl7('MSH|^~\\&|A|B|C|D|20261023||ORU^R01|1|P|2.5')), (e: unknown) => e instanceof Hl7Error && e.ack === 'AR')
  assert.throws(() => toAdtIntent(parseHl7('MSH|^~\\&|A|B|C|D|20261023||ADT^A08|1|P|2.5\rPID|||1')), (e: unknown) => e instanceof Hl7Error && e.code === 'unsupported_event')
  assert.throws(() => parseHl7('kein hl7'), Hl7Error)
  const ack = buildAck(parseHl7(A01), 'AA', 'admitted', new Date('2026-10-23T10:16:00'))
  const [msh, msa] = ack.trim().split('\r')
  assert.match(msh, /^MSH\|\^~\\&\|CAREOS\|LINDENHOF\|KIS\|SPITAL\|20261023101600\|\|ACK\^A01\^ACK\|ACK\d+\|P\|2\.5$/)
  assert.equal(msa, 'MSA|AA|MSG00001|admitted')
})
