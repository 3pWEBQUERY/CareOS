import { test } from 'node:test'
import assert from 'node:assert/strict'
import { profileAccess, responsibleFor } from './people-policy'
import type { Grant } from './permissions'

const loc = (u: string) => ({ wg1: 'haus', wg2: 'haus', dwg: 'bach' })[u]
const nurse: Grant[] = [{ permissions: ['team.read', 'schedule.read'], unitId: 'wg2', locationId: null }]
const wardLead: Grant[] = [{ permissions: ['team.read', 'schedule.read', 'schedule.manage'], unitId: null, locationId: 'haus' }]
const hr: Grant[] = [{ permissions: ['team.read', 'schedule.read', 'admin.users', 'learn.manage'], unitId: null, locationId: null }]
const pdlUnit: Grant[] = [{ permissions: ['team.read', 'learn.manage'], unitId: 'wg1', locationId: null }]
const inWg2 = { unitIds: ['wg2'], locationIds: [], orgWide: false }
const noUnit = { unitIds: [], locationIds: [], orgWide: true }

test('Zuständigkeit: organisationsweit, über Standort, über Bereich; Personen ohne Bereich nur organisationsweit', () => {
  assert.equal(responsibleFor(hr, 'admin.users', inWg2, loc), true)
  assert.equal(responsibleFor(wardLead, 'schedule.manage', inWg2, loc), true)
  assert.equal(responsibleFor(wardLead, 'schedule.manage', { unitIds: ['dwg'], locationIds: [], orgWide: false }, loc), false)
  assert.equal(responsibleFor(wardLead, 'schedule.manage', noUnit, loc), false)
  assert.equal(responsibleFor(pdlUnit, 'learn.manage', inWg2, loc), false)
  assert.equal(responsibleFor(pdlUnit, 'learn.manage', { unitIds: ['wg2', 'wg1'], locationIds: [], orgWide: false }, loc), true)
  assert.equal(responsibleFor(wardLead, 'schedule.manage', { unitIds: [], locationIds: ['haus'], orgWide: false }, loc), true)
  assert.equal(responsibleFor(nurse, 'schedule.manage', inWg2, loc), false)
})

test('Profil: private Nummer nur für die Person, zuständige Leitung/HR oder bei Freigabe', () => {
  const base = { personId: 'p', person: inWg2, unitLocation: loc }
  const colleague = profileAccess({ ...base, viewerId: 'n', grants: nurse, phoneShared: false })
  assert.equal(colleague.privatePhone, false)
  assert.equal(colleague.absenceReason, false)
  assert.equal(colleague.qualificationValidity, false)
  assert.equal(colleague.training, false)
  assert.equal(colleague.shifts, true)
  assert.equal(colleague.adminLink, false)
  assert.equal(profileAccess({ ...base, viewerId: 'n', grants: nurse, phoneShared: true }).privatePhone, true)
  const lead = profileAccess({ ...base, viewerId: 'l', grants: wardLead, phoneShared: false })
  assert.deepEqual([lead.privatePhone, lead.absenceReason, lead.manager, lead.training], [true, true, true, false])
  const h = profileAccess({ ...base, viewerId: 'h', grants: hr, phoneShared: false })
  assert.deepEqual([h.privatePhone, h.training, h.adminLink], [true, true, true])
  const self = profileAccess({ ...base, viewerId: 'p', grants: nurse, phoneShared: false })
  assert.deepEqual([self.self, self.privatePhone, self.training, self.adminLink], [true, true, true, false])
  // ohne schedule.read keine Dienste von anderen
  assert.equal(profileAccess({ ...base, viewerId: 'x', grants: [{ permissions: ['team.read'], unitId: null, locationId: null }], phoneShared: false }).shifts, false)
})
