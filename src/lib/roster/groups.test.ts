import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupStaff, staffGroup } from './groups'

test('Gruppen aus Funktionsbezeichnung und Qualifikation (Schweizer Abschlüsse)', () => {
  assert.equal(staffGroup('', 'Pflegefachfrau HF').group, 'hf')
  assert.equal(staffGroup('', 'Fachmann Gesundheit EFZ').group, 'fage')
  assert.equal(staffGroup('FaGe EFZ', '').group, 'fage')
  assert.equal(staffGroup('', 'Assistentin Gesundheit und Soziales EBA').group, 'ags')
  assert.equal(staffGroup('', 'Pflegehelferin SRK').group, 'srk')
  assert.equal(staffGroup('', 'Stationsleiterin').group, 'lead')
  assert.equal(staffGroup('', 'Studierende HF Pflege').group, 'students')
  assert.equal(staffGroup('', 'Lernende FaGe').group, 'apprentices')
  assert.deepEqual(staffGroup('Aktivierungsfachfrau', 'Aktivierung'), { group: 'other', custom: 'Aktivierungsfachfrau' })
  assert.deepEqual(staffGroup('', 'Hauswirtschaft'), { group: 'other' })
})

test('Reihenfolge: Leitung, HF, FaGe, AGS, SRK, eigene, Studierende, Lernende, Weitere; innerhalb nach Name', () => {
  const p = (name: string, job: string, qual = '', level = 0) => ({ name, job, qual, level })
  const out = groupStaff([
    p('Zuber', 'Pflegehelferin SRK'), p('Ammann', 'Lernende FaGe'), p('Meyer', 'Pflegefachmann HF'), p('Bieri', 'Fachfrau Gesundheit EFZ'),
    p('Arnold', 'Pflegefachfrau HF'), p('Koch', 'Stationsleiter'), p('Huber', 'Aktivierung', 'Aktivierungsfachfrau', 2), p('Frei', 'Studierende HF'), p('Gut', 'Küche'),
  ]).map((x) => x.name)
  assert.deepEqual(out, ['Koch', 'Arnold', 'Meyer', 'Bieri', 'Zuber', 'Huber', 'Frei', 'Ammann', 'Gut'])
})
