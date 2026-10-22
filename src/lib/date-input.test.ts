import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDaysIso, addMonthsIso, clampIso, dateParts, datePlaceholder, endOfWeekIso, formatDate, formatDateTime, fullDateLabel,
  isIsoDate, isIsoDateTime, monthGrid, monthLabel, nearestIndex, outOfRange, parseDate, parseTime, startOfWeekIso, timeOptions, weekdayNames,
} from './date-input'

const TODAY = '2026-10-22'

test('Reihenfolge und Trennzeichen aus Intl', () => {
  for (const l of ['de', 'fr', 'it'] as const) assert.deepEqual(dateParts(l), { order: ['day', 'month', 'year'], sep: '.' })
  assert.deepEqual(dateParts('en'), { order: ['day', 'month', 'year'], sep: '/' })
  assert.equal(datePlaceholder('de'), 'TT.MM.JJJJ')
  assert.equal(datePlaceholder('fr'), 'JJ.MM.AAAA')
  assert.equal(datePlaceholder('it'), 'GG.MM.AAAA')
  assert.equal(datePlaceholder('en'), 'DD/MM/YYYY')
})

test('Formatierung in allen vier Sprachen', () => {
  assert.equal(formatDate('2026-01-05', 'de'), '05.01.2026')
  assert.equal(formatDate('2026-01-05', 'fr'), '05.01.2026')
  assert.equal(formatDate('2026-01-05', 'it'), '05.01.2026')
  assert.equal(formatDate('2026-01-05', 'en'), '05/01/2026')
  assert.equal(formatDate('', 'de'), '')
  assert.equal(formatDate('2026-02-30', 'de'), '')
  assert.equal(formatDateTime('2026-10-22T07:05', 'en'), '22/10/2026 07:05')
  assert.equal(formatDateTime('2026-10-22', 'de'), '')
})

test('Datum parsen: vollständig, kurz, tolerant', () => {
  for (const l of ['de', 'fr', 'it'] as const) {
    assert.equal(parseDate('01.02.2026', l, TODAY), '2026-02-01')
    assert.equal(parseDate('1.2.26', l, TODAY), '2026-02-01')
    assert.equal(parseDate('1.2.', l, TODAY), '2026-02-01')
    assert.equal(parseDate('1.2', l, TODAY), '2026-02-01')
  }
  assert.equal(parseDate('01/02/2026', 'en', TODAY), '2026-02-01')
  assert.equal(parseDate('1/2/26', 'en', TODAY), '2026-02-01')
  assert.equal(parseDate('1.2.2026', 'en', TODAY), '2026-02-01') // Punkt auch in EN (Ziffernblock)
  assert.equal(parseDate('1-2-2026', 'de', TODAY), '2026-02-01')
  assert.equal(parseDate(' 1 2 2026 ', 'de', TODAY), '2026-02-01')
  assert.equal(parseDate('01022026', 'de', TODAY), '2026-02-01')
  assert.equal(parseDate('010226', 'it', TODAY), '2026-02-01')
  assert.equal(parseDate('0102', 'fr', TODAY), '2026-02-01')
  assert.equal(parseDate('5', 'de', TODAY), '2026-10-05')
  assert.equal(parseDate('2026-02-01', 'en', TODAY), '2026-02-01')
})

test('Datum parsen: Kurzwahl in allen Sprachen', () => {
  for (const w of ['heute', 'Heute', 'today', 'oggi', "aujourd'hui", 'aujourd’hui']) assert.equal(parseDate(w, 'de', TODAY), TODAY, w)
  for (const w of ['morgen', 'demain', 'domani', 'tomorrow']) assert.equal(parseDate(w, 'fr', TODAY), '2026-10-23', w)
  for (const w of ['gestern', 'hier', 'ieri', 'yesterday']) assert.equal(parseDate(w, 'it', TODAY), '2026-10-21', w)
  assert.equal(parseDate('+3', 'en', TODAY), '2026-10-25')
  assert.equal(parseDate('-10', 'de', TODAY), '2026-10-12')
  assert.equal(parseDate('+ 14', 'de', TODAY), '2026-11-05')
})

test('Zweistellige Jahre: Geburtsdaten im letzten Jahrhundert', () => {
  assert.equal(parseDate('3.4.45', 'de', TODAY), '1945-04-03')
  assert.equal(parseDate('3.4.36', 'de', TODAY), '2036-04-03') // bis 10 Jahre voraus
  assert.equal(parseDate('3.4.37', 'de', TODAY), '1937-04-03')
  assert.equal(parseDate('3.4.30', 'en', TODAY), '2030-04-03')
  assert.equal(parseDate('3.4.00', 'de', TODAY), '2000-04-03')
})

test('Datum parsen: ungültig und leer', () => {
  assert.equal(parseDate('', 'de', TODAY), '')
  assert.equal(parseDate('   ', 'de', TODAY), '')
  for (const s of ['32.01.2026', '31.04.2026', '00.01.2026', '1.13.2026', 'abc', '1.2.3.4', '123', '1.2.202', '12345', '29.02.2025', '1.2.1700', '111.2.2026'])
    assert.equal(parseDate(s, 'de', TODAY), null, s)
  assert.equal(parseDate('02/31/2026', 'en', TODAY), null) // kein US-Format
})

test('Schaltjahr', () => {
  assert.equal(parseDate('29.02.2028', 'de', TODAY), '2028-02-29')
  assert.equal(parseDate('29.02.2000', 'de', TODAY), '2000-02-29')
  assert.equal(parseDate('29.02.1900', 'de', TODAY), null)
  assert.equal(parseDate('29.02.2100', 'de', TODAY), null)
  assert.equal(addMonthsIso('2028-01-31', 1), '2028-02-29')
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonthsIso('2026-03-31', -1), '2026-02-28')
  assert.equal(addMonthsIso('2026-12-15', 1), '2027-01-15')
  assert.equal(addMonthsIso('2026-01-15', -13), '2024-12-15')
  assert.equal(addDaysIso('2028-02-28', 1), '2028-02-29')
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01')
  assert.ok(isIsoDate('2028-02-29'))
  assert.ok(!isIsoDate('2026-02-29'))
})

test('Zeit parsen', () => {
  const now = new Date(2026, 9, 22, 14, 37)
  const ok: [string, string][] = [
    ['7:30', '07:30'], ['07:30', '07:30'], ['7.30', '07:30'], ['7,30', '07:30'], ['730', '07:30'], ['0730', '07:30'],
    ['7', '07:00'], ['17', '17:00'], ['1730', '17:30'], ['17h30', '17:30'], ['17 h 30', '17:30'], ['17h', '17:00'], ['17 Uhr', '17:00'],
    ['0', '00:00'], ['23:59', '23:59'], ['0:05', '00:05'], ['jetzt', '14:37'], ['maintenant', '14:37'], ['adesso', '14:37'], ['Now', '14:37'],
  ]
  for (const [i, o] of ok) assert.equal(parseTime(i, now), o, i)
  assert.equal(parseTime('', now), '')
  for (const s of ['24:00', '7:60', '25', '7:5', '12345', 'abc', '7:30 pm', '-1']) assert.equal(parseTime(s, now), null, s)
})

test('Bereich (min/max) und Begrenzung', () => {
  assert.equal(outOfRange('2026-10-21', '2026-10-22'), 'min')
  assert.equal(outOfRange('2026-10-22', '2026-10-22', '2026-10-22'), null)
  assert.equal(outOfRange('2026-10-23', null, '2026-10-22'), 'max')
  assert.equal(outOfRange('', '2026-10-22'), null)
  assert.equal(outOfRange('2026-10-22T23:59', null, '2026-10-22T23:59'), null)
  assert.equal(outOfRange('2026-10-23T00:00', null, '2026-10-22T23:59'), 'max')
  assert.equal(outOfRange('07:00', '07:30'), 'min')
  assert.equal(clampIso('2026-01-01', '2026-10-22'), '2026-10-22')
  assert.equal(clampIso('2027-01-01', null, '2026-10-22'), '2026-10-22')
  assert.equal(clampIso('2026-05-05', '2026-01-01', '2026-12-31'), '2026-05-05')
  assert.ok(isIsoDateTime('2026-10-22T07:05'))
  assert.ok(!isIsoDateTime('2026-10-22T24:00'))
})

test('Kalenderblatt beginnt am Montag', () => {
  const g = monthGrid(2026, 10)
  assert.equal(g.length, 6)
  assert.equal(g[0][0], '2026-09-28') // 1.10.2026 ist ein Donnerstag
  assert.equal(g[0][3], '2026-10-01')
  assert.equal(g[5][6], '2026-11-08')
  assert.equal(monthGrid(2027, 2)[0][0], '2027-02-01') // Februar 2027 beginnt am Montag
  assert.equal(startOfWeekIso('2026-10-25'), '2026-10-19')
  assert.equal(endOfWeekIso('2026-10-19'), '2026-10-25')
})

test('Namen über Intl in App-Sprache', () => {
  assert.equal(monthLabel(2026, 10, 'de'), 'Oktober 2026')
  assert.equal(monthLabel(2026, 10, 'fr'), 'Octobre 2026')
  assert.equal(monthLabel(2026, 10, 'it'), 'Ottobre 2026')
  assert.equal(monthLabel(2026, 10, 'en'), 'October 2026')
  assert.equal(weekdayNames('de')[0].short, 'Mo')
  assert.equal(weekdayNames('de')[6].long, 'Sonntag')
  assert.equal(weekdayNames('fr')[0].short, 'Lun')
  assert.equal(weekdayNames('it')[0].long, 'lunedì')
  assert.equal(weekdayNames('en')[0].short, 'Mon')
  assert.equal(fullDateLabel('2026-10-22', 'de'), 'Donnerstag, 22. Oktober 2026')
  assert.match(fullDateLabel('2026-10-22', 'en'), /^Thursday,? 22 October 2026$/)
  assert.match(fullDateLabel('2026-10-22', 'fr'), /^jeudi,? 22 octobre 2026$/)
})

test('Zeitraster', () => {
  const all = timeOptions()
  assert.equal(all.length, 96)
  assert.equal(all[0], '00:00')
  assert.equal(all[95], '23:45')
  assert.equal(timeOptions(30).length, 48)
  assert.equal(timeOptions(0).length, 96)
  assert.deepEqual(timeOptions(60, '07:00', '09:00'), ['07:00', '08:00', '09:00'])
  assert.equal(nearestIndex(all, '07:20'), all.indexOf('07:30'))
  assert.equal(nearestIndex(all, '07:30'), all.indexOf('07:30'))
  assert.equal(nearestIndex(all, '23:50'), 95)
  assert.equal(nearestIndex([], '07:00'), -1)
})
