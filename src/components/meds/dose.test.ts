import { test } from 'node:test'
import assert from 'node:assert/strict'
import { doseText } from './dose'

test('Dosis mit Einheit (PRD §32)', () => {
  assert.equal(doseText('1', 'Tbl.'), '1 Tbl.')
  assert.equal(doseText('0,5', 'Tbl.'), '0,5 Tbl.')
  assert.equal(doseText('½', 'Tbl. zermörsert'), '½ Tbl. zermörsert')
  assert.equal(doseText('18 IE', 's.c.'), '18 IE')
  assert.equal(doseText('2', 's.c.'), '2')
  assert.equal(doseText('1', '4 gtt.'), '4 gtt.')
  assert.equal(doseText('2', '10 ml'), '2 × 10 ml')
  assert.equal(doseText('n. Schema', 's.c.'), 'n. Schema')
  assert.equal(doseText('1', null), '1')
  assert.equal(doseText('', 'Tbl.'), '')
})
