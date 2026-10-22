import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeCsv, detectDelimiter, parseCsv, safeCell, toCsv } from './csv'
import { mapHeader, parseDateCell, parseQualificationCell, splitCell, templateHeader, validateRow } from './specs'

test('CSV: Trennzeichen erkennen (Semikolon, Komma, Tab), Standard Semikolon', () => {
  assert.equal(detectDelimiter('Name;Vorname;Geburtsdatum\r\nA;B;C'), ';')
  assert.equal(detectDelimiter('email,lastName,firstName\nx,y,z'), ',')
  assert.equal(detectDelimiter('a\tb\tc'), '\t')
  assert.equal(detectDelimiter('"Name; mit Semikolon",Vorname,X'), ',')
  assert.equal(detectDelimiter('Nur eine Spalte'), ';')
})

test('CSV: Anführungszeichen, "" als Escape, Zeilenumbruch im Feld, CRLF, leere Zeilen und Zeilennummern', () => {
  const t = parseCsv('Name;Bemerkung\r\nMuster;"Sagt ""Grüezi""; gern"\r\n\r\nMeier;"zwei\r\nZeilen"\r\nKeller;\r\n')
  assert.deepEqual(t.header, ['Name', 'Bemerkung'])
  assert.deepEqual(t.rows.map((r) => r.cells), [['Muster', 'Sagt "Grüezi"; gern'], ['Meier', 'zwei\r\nZeilen'], ['Keller', '']])
  // Zeile 3 ist leer; Meier beginnt in Zeile 4, Keller nach dem Umbruch im Feld in Zeile 6
  assert.deepEqual(t.rows.map((r) => r.line), [2, 4, 6])
})

test('CSV: letzte Zeile ohne Umbruch, Leerzeichen werden getrimmt, nur LF', () => {
  const t = parseCsv('a,b\n 1 , 2 \n3,4')
  assert.deepEqual(t.rows.map((r) => r.cells), [['1', '2'], ['3', '4']])
})

test('CSV: UTF-8 mit BOM und Windows-1252 (Excel) werden korrekt gelesen', () => {
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Bühler;Zoé')])
  assert.equal(decodeCsv(utf8), 'Bühler;Zoé')
  const cp1252 = new Uint8Array([0x42, 0xfc, 0x68, 0x6c, 0x65, 0x72]) // «Bühler» in Windows-1252
  assert.equal(decodeCsv(cp1252), 'Bühler')
})

test('CSV schreiben: Escape, BOM, Schutz vor Formel-Injektion', () => {
  const out = toCsv([['Zeile', 'Fehler'], ['2', 'Spalte «Name»; fehlt'], ['3', '=HYPERLINK("x")'], ['4', '-5']])
  assert.ok(out.startsWith('﻿'))
  assert.ok(out.includes('"Spalte «Name»; fehlt"'))
  assert.ok(out.includes(`"'=HYPERLINK(""x"")"`))
  assert.ok(out.includes('4;-5'))
  assert.equal(safeCell('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(safeCell('+41 44 000 00 00'), "'+41 44 000 00 00")
})

test('Datum: Schweizer und ISO-Format, ungültige Tage, zweistellige Jahre', () => {
  assert.deepEqual(parseDateCell('14.03.1938'), { ok: true, iso: '1938-03-14' })
  assert.deepEqual(parseDateCell('1.2.2027'), { ok: true, iso: '2027-02-01' })
  assert.deepEqual(parseDateCell('2026-11-02'), { ok: true, iso: '2026-11-02' })
  assert.deepEqual(parseDateCell('02/11/2026'), { ok: true, iso: '2026-11-02' })
  assert.deepEqual(parseDateCell('31.02.2026'), { ok: false, code: 'date' })
  assert.deepEqual(parseDateCell('29.02.2028'), { ok: true, iso: '2028-02-29' })
  assert.deepEqual(parseDateCell('14.03.38'), { ok: false, code: 'year4' })
  assert.deepEqual(parseDateCell('morgen'), { ok: false, code: 'date' })
})

test('Kopfzeile: Spalten in allen Sprachen, ohne Akzente/Satzzeichen; fehlende Pflichtspalten und unbekannte Spalten', () => {
  const m = mapHeader('residents', ['NOM', 'Prénom', 'date de naissance', 'Unité', 'Chambre', 'Lieblingsfarbe'])
  assert.deepEqual(Object.keys(m.index).sort(), ['birthDate', 'firstName', 'lastName', 'room', 'unit'])
  assert.deepEqual(m.missing, [])
  assert.deepEqual(m.unknown, ['Lieblingsfarbe'])
  const s = mapHeader('staff', ['E-Mail', 'Nachname', 'Vorname', 'e mail'])
  assert.deepEqual(s.duplicate, ['e mail'])
  assert.deepEqual(mapHeader('shifts', ['Datum', 'Dienst']).missing, ['unit'])
  // Vorlage in jeder Sprache wird wieder vollständig erkannt
  for (const lang of ['de', 'fr', 'it', 'en'] as const) {
    for (const kind of ['residents', 'staff', 'shifts'] as const) {
      const h = mapHeader(kind, templateHeader(kind, lang))
      assert.equal(h.missing.length + h.unknown.length + h.duplicate.length, 0, `${kind}/${lang}`)
    }
  }
})

test('Zeilenprüfung Bewohnende: Pflichtfelder, Zukunftsdatum, Geschlecht, REA, Pflegestufe, Listen', () => {
  const map = mapHeader('residents', ['Nachname', 'Vorname', 'Geburtsdatum', 'Bereich', 'Geschlecht', 'REA', 'Pflegestufe', 'Allergien'])
  const ok = validateRow('residents', map, ['Muster', 'Erika', '14.03.1938', 'WG 1', 'weiblich', 'Nein', '6', 'Penicillin | Nüsse, Latex'], '2026-10-22')
  assert.deepEqual(ok.issues, [])
  assert.equal(ok.values.birthDate, '1938-03-14')
  assert.equal(ok.values.sex, 'f')
  assert.equal(ok.values.rea, 'no')
  assert.equal(ok.values.careLevel, 6)
  assert.deepEqual(ok.values.allergies, ['Penicillin', 'Nüsse', 'Latex'])
  const bad = validateRow('residents', map, ['', 'Erika', '01.01.2030', 'WG 1', 'z', 'vielleicht', '13', ''], '2026-10-22')
  assert.deepEqual(bad.issues.map((i) => `${i.code}:${i.col}`), ['required:lastName', 'dateFuture:birthDate', 'sex:sex', 'int:careLevel', 'rea:rea'])
  assert.equal(validateRow('residents', map, ['A', 'B', '1.1.1940', 'X', '', '', '', ''], '2026-10-22').values.rea, 'unknown')
})

test('Zeilenprüfung Personal: E-Mail, Telefon, Sprache, Geltungsbereich', () => {
  const map = mapHeader('staff', ['E-Mail', 'Nachname', 'Vorname', 'Telefon privat', 'Sprache', 'Geltungsbereich'])
  const r = validateRow('staff', map, ['Anna.Muster@Example.CH', 'Muster', 'Anna', '079 000 00 00', 'Französisch', 'Standort'], '2026-10-22')
  assert.deepEqual(r.issues, [])
  assert.equal(r.values.email, 'anna.muster@example.ch')
  assert.equal(r.values.locale, 'fr')
  assert.equal(r.values.roleScope, 'location')
  const b = validateRow('staff', map, ['kein-mail', 'M', 'A', 'abc', 'klingonisch', 'Planet'], '2026-10-22')
  assert.deepEqual(b.issues.map((i) => i.code), ['email', 'phone', 'scope', 'locale'])
})

test('Listen und Qualifikationen mit Gültigkeit', () => {
  assert.deepEqual(splitCell(' A | B ;A,  '), ['A', 'B'])
  assert.deepEqual(parseQualificationCell('BLS-AED: 31.12.2027'), { name: 'BLS-AED', validUntil: '2027-12-31' })
  assert.deepEqual(parseQualificationCell('Pflegefachperson HF'), { name: 'Pflegefachperson HF', validUntil: null })
  assert.equal(parseQualificationCell('Wundexpertin: 31.02.2027').bad, true)
})
