import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blocking, checkAllergies, normalize } from './allergy-check'

test('Allergie-Abgleich: Wirkstoffklasse Penicillin trifft Amoxicillin und Handelsnamen', () => {
  for (const name of ['Amoxicillin 750 mg', 'Co-Amoxi Mepha 1 g', 'Augmentin', 'Flucloxacillin']) {
    const m = checkAllergies(['Penicillin'], name)
    assert.equal(m.length, 1, name)
    assert.equal(m[0].kind, 'class', name)
    assert.equal(m[0].classKey, 'penicillin')
  }
  assert.equal(blocking(checkAllergies(['Penicillin'], 'Co-Amoxi 1 g')), true)
})

test('Allergie-Abgleich: Kreuzreaktion Penicillin → Cephalosporin nur als Hinweis', () => {
  const m = checkAllergies(['Penicillinallergie (Exanthem)'], 'Cefuroxim 500 mg')
  assert.equal(m.length, 1)
  assert.equal(m[0].kind, 'cross')
  assert.equal(blocking(m), false)
})

test('Allergie-Abgleich: direkter Treffer, Akzente und Gross-/Kleinschreibung', () => {
  assert.equal(checkAllergies(['Métamizol'], 'Metamizol Tropfen')[0]?.kind, 'direct')
  assert.equal(checkAllergies(['NSAR'], 'Ibuprofen 400 mg')[0]?.classKey, 'nsaid')
  assert.equal(checkAllergies(['ASS'], 'Aspirin Cardio 100')[0]?.classKey, 'nsaid')
  assert.equal(checkAllergies(['Sulfonamide'], 'Bactrim forte')[0]?.classKey, 'sulfonamide')
})

test('Allergie-Abgleich: keine Fehltreffer innerhalb von Wörtern', () => {
  assert.deepEqual(checkAllergies(['Penicillin'], 'Tamoxifen 20 mg'), [])
  assert.deepEqual(checkAllergies(['Laktose'], 'Laktulose Sirup'), [])
  assert.deepEqual(checkAllergies(['ASS'], 'Kalium Effervetten Classic'), [])
  assert.deepEqual(checkAllergies(['Nüsse', 'Latex'], 'Pantoprazol 40 mg'), [])
  assert.deepEqual(checkAllergies([], 'Amoxicillin'), [])
  assert.deepEqual(checkAllergies(['Penicillin'], '  '), [])
})

test('Allergie-Abgleich: je Allergie ein Treffer, mehrere Allergien', () => {
  const m = checkAllergies(['Penicillin', 'Opiate'], 'Tramal retard 100 mg')
  assert.equal(m.length, 1)
  assert.equal(m[0].allergy, 'Opiate')
  assert.equal(normalize('Co-Amoxi, 1g'), ' co-amoxi 1g ')
})
