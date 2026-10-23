/**
 * Kalender-Abo der eigenen Dienste (PRD §19, RFC 5545) – reine Logik ohne Datenbank, testbar.
 * Zeiten als Ortszeit mit TZID=Europe/Zurich (VTIMEZONE enthalten), Nachtdienste enden am Folgetag,
 * UID je Dienst (stabil, Kalender aktualisieren statt duplizieren). Zeilen nach 75 Oktetten gefaltet.
 */
import { durationMin, shiftDay, toMin } from '@/lib/roster/model'

export const ICAL_TZ = 'Europe/Zurich'
/** Zeitraum des Feeds: ein Monat zurück, drei Monate voraus */
export const FEED_PAST_DAYS = 31
export const FEED_AHEAD_DAYS = 92

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${ICAL_TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19810329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19961027T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
]

/** TEXT-Werte: Backslash, Semikolon, Komma und Zeilenumbrüche maskieren. */
export const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n?|\n/g, '\\n')

/** Inhaltszeile falten: höchstens 75 Oktette je Zeile, Fortsetzung mit Leerzeichen, UTF-8-Zeichen nie zerteilt. */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const limit = out.length ? 74 : 75
    if (bytes + n > limit) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

/** "2026-10-24" + "21:30" → "20261024T213000" (Ortszeit) */
export const localStamp = (day: string, time: string) => `${day.replace(/-/g, '')}T${time.slice(0, 2)}${time.slice(3, 5)}00`

/** UTC-Zeitstempel (DTSTAMP) */
export const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Ende eines Dienstes: endet er vor oder zur Beginnzeit (über Mitternacht), am Folgetag. */
export function shiftEnd(day: string, start: string, end: string) {
  const endsNextDay = toMin(start) + durationMin({ start, end }) >= 1440
  return { day: endsNextDay ? shiftDay(day, 1) : day, time: end }
}

export type FeedEvent = {
  uid: string
  day: string
  start: string
  end: string
  summary: string
  location?: string | null
  description?: string | null
  tentative?: boolean
}

export function eventLines(e: FeedEvent, dtstamp: Date): string[] {
  const end = shiftEnd(e.day, e.start, e.end)
  return [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${utcStamp(dtstamp)}`,
    `DTSTART;TZID=${ICAL_TZ}:${localStamp(e.day, e.start)}`,
    `DTEND;TZID=${ICAL_TZ}:${localStamp(end.day, end.time)}`,
    `SUMMARY:${escapeText(e.summary)}`,
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
    `STATUS:${e.tentative ? 'TENTATIVE' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ]
}

/** Vollständiger Kalender (VCALENDAR) mit CRLF-Zeilenenden. */
export function buildCalendar(opts: { name: string; events: FeedEvent[]; now?: Date }): string {
  const now = opts.now ?? new Date()
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CareOS//Dienstplan//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`, `X-WR-TIMEZONE:${ICAL_TZ}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
    ...opts.events.flatMap((e) => eventLines(e, now)),
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/**
 * Monate im Entwurf (SchedulePeriod.status = draft) sind nur für die Planenden sichtbar: Dienste solcher Monate
 * werden ausgeblendet, ausser die Person darf den Bereich planen (schedule.manage).
 */
export function hideDraftShifts<T extends { unitId: string; day: string }>(shifts: T[], drafts: { unitId: string; month: string }[], canManage: (unitId: string) => boolean): T[] {
  const hidden = new Set(drafts.filter((d) => !canManage(d.unitId)).map((d) => `${d.unitId}|${d.month}`))
  return shifts.filter((s) => !hidden.has(`${s.unitId}|${s.day.slice(0, 7)}`))
}
