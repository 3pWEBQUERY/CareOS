import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCalendar, escapeText, eventLines, foldLine, hideDraftShifts, shiftEnd } from './ical'

const octets = (s: string) => new TextEncoder().encode(s).length

test('iCal: Text maskieren (Backslash, Semikolon, Komma, Zeilenumbruch)', () => {
  assert.equal(escapeText('Früh; Wohngruppe A, Lindenhof\\Nord\nBitte pünktlich'), 'Früh\\; Wohngruppe A\\, Lindenhof\\\\Nord\\nBitte pünktlich')
  assert.equal(escapeText('a\r\nb'), 'a\\nb')
})

test('iCal: Zeilen nach 75 Oktetten falten, Umlaute nie zerteilen', () => {
  assert.equal(foldLine('SUMMARY:kurz'), 'SUMMARY:kurz')
  const long = 'DESCRIPTION:' + 'Übergabe für Frühdienst – '.repeat(10)
  const folded = foldLine(long)
  const parts = folded.split('\r\n')
  assert.ok(parts.length > 1)
  assert.ok(parts.every((p) => octets(p) <= 75), 'jede Zeile höchstens 75 Oktette')
  assert.ok(parts.slice(1).every((p) => p.startsWith(' ')), 'Fortsetzung mit Leerzeichen')
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), long, 'Entfalten ergibt den Originaltext')
  assert.ok(!folded.includes('�'))
})

test('iCal: Nachtdienst endet am Folgetag, auch über das Monatsende', () => {
  assert.deepEqual(shiftEnd('2026-10-24', '06:45', '15:15'), { day: '2026-10-24', time: '15:15' })
  assert.deepEqual(shiftEnd('2026-10-24', '21:30', '07:00'), { day: '2026-10-25', time: '07:00' })
  assert.deepEqual(shiftEnd('2026-10-31', '22:00', '06:30'), { day: '2026-11-01', time: '06:30' })
  // 24-h-Dienst (gleiche Zeit) endet am Folgetag
  assert.deepEqual(shiftEnd('2026-12-31', '08:00', '08:00'), { day: '2027-01-01', time: '08:00' })
  const lines = eventLines({ uid: 'shift-n1@careos', day: '2026-10-24', start: '21:30', end: '07:00', summary: 'Nachtdienst (N)' }, new Date('2026-10-23T10:00:00Z'))
  assert.ok(lines.includes('DTSTART;TZID=Europe/Zurich:20261024T213000'))
  assert.ok(lines.includes('DTEND;TZID=Europe/Zurich:20261025T070000'))
  assert.ok(lines.includes('DTSTAMP:20261023T100000Z'))
  assert.ok(lines.includes('UID:shift-n1@careos'))
})

test('iCal: Kalender mit VTIMEZONE, CRLF und einer UID je Dienst', () => {
  const ics = buildCalendar({
    name: 'Dienste · Lindenhof',
    now: new Date('2026-10-23T10:00:00Z'),
    events: [
      { uid: 'shift-a@careos', day: '2026-10-24', start: '06:45', end: '15:15', summary: 'Frühdienst (F)', location: 'Wohngruppe A', description: 'Bitte, früher kommen' },
      { uid: 'shift-b@careos', day: '2026-10-25', start: '21:30', end: '07:00', summary: 'Nachtdienst (N)', tentative: true },
    ],
  })
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.ok(!/[^\r]\n/.test(ics), 'nur CRLF')
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Zurich/)
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2)
  assert.equal(new Set(ics.match(/^UID:.*$/gm)).size, 2)
  assert.match(ics, /DESCRIPTION:Bitte\\, früher kommen/)
  assert.match(ics, /X-WR-CALNAME:Dienste · Lindenhof/)
  assert.match(ics, /STATUS:TENTATIVE/)
})

test('iCal: Monate im Entwurf ausblenden, ausser für die planende Person', () => {
  const shifts = [
    { id: '1', unitId: 'A', day: '2026-10-30' },
    { id: '2', unitId: 'A', day: '2026-11-02' },
    { id: '3', unitId: 'B', day: '2026-11-03' },
  ]
  const drafts = [{ unitId: 'A', month: '2026-11' }, { unitId: 'B', month: '2026-11' }]
  assert.deepEqual(hideDraftShifts(shifts, drafts, () => false).map((s) => s.id), ['1'])
  assert.deepEqual(hideDraftShifts(shifts, drafts, (u) => u === 'B').map((s) => s.id), ['1', '3'])
  assert.deepEqual(hideDraftShifts(shifts, [], () => false).map((s) => s.id), ['1', '2', '3'])
})
