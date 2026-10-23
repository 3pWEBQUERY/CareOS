import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confirmDueAt, confirmState, dueForEscalation, mayConfirm, phoneOrderHours, PHONE_ORDER_HOURS_DEFAULT } from './phone-orders'

const at = new Date('2026-10-23T14:00:00+02:00')
const h = (n: number) => new Date(at.getTime() + n * 3600_000)

test('Telefonische Verordnung: Frist 24 h, schriftlich ohne Frist', () => {
  assert.equal(confirmDueAt('phone', at, 24)?.toISOString(), h(24).toISOString())
  assert.equal(confirmDueAt('verbal', at, 12)?.toISOString(), h(12).toISOString())
  assert.equal(confirmDueAt('written', at, 24), null)
})

test('Telefonische Verordnung: Frist aus den Einstellungen, ungültige Werte → Standard', () => {
  assert.equal(phoneOrderHours({ medication: { phoneOrderConfirmHours: 48 } }), 48)
  assert.equal(phoneOrderHours({ medication: { phoneOrderConfirmHours: 0 } }), PHONE_ORDER_HOURS_DEFAULT)
  assert.equal(phoneOrderHours({ medication: { phoneOrderConfirmHours: 500 } }), PHONE_ORDER_HOURS_DEFAULT)
  assert.equal(phoneOrderHours(null), PHONE_ORDER_HOURS_DEFAULT)
})

test('Telefonische Verordnung: Zustand und einmalige Eskalation nach Fristablauf', () => {
  const m = { orderSource: 'phone', confirmedAt: null as Date | null, confirmDueAt: h(24), confirmEscalatedAt: null as Date | null }
  assert.equal(confirmState(m, h(1)), 'pending')
  assert.equal(dueForEscalation(m, h(23)), false)
  assert.equal(confirmState(m, h(24)), 'overdue')
  assert.equal(dueForEscalation(m, h(25)), true)
  assert.equal(dueForEscalation({ ...m, confirmEscalatedAt: h(25) }, h(26)), false)
  assert.equal(dueForEscalation({ ...m, confirmedAt: h(2) }, h(30)), false)
  assert.equal(confirmState({ ...m, orderSource: 'written' }, h(30)), 'none')
})

test('Telefonische Verordnung: Gegenzeichnung nur ärztlich und nicht durch die entgegennehmende Person', () => {
  assert.deepEqual(mayConfirm({ userId: 'dr', createdById: 'nurse', canPrescribe: true, state: 'pending' }), { ok: true })
  assert.deepEqual(mayConfirm({ userId: 'dr', createdById: 'nurse', canPrescribe: true, state: 'overdue' }), { ok: true })
  assert.equal(mayConfirm({ userId: 'nurse', createdById: 'nurse', canPrescribe: true, state: 'pending' }).ok, false)
  assert.equal(mayConfirm({ userId: 'nurse2', createdById: 'nurse', canPrescribe: false, state: 'pending' }).ok, false)
  assert.equal(mayConfirm({ userId: 'dr', createdById: 'nurse', canPrescribe: true, state: 'confirmed' }).ok, false)
})
