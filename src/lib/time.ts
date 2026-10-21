/**
 * Zeit-Hilfen. Der Server läuft mit TZ=Europe/Zurich (Railway-Variable), daher sind lokale Date-Methoden
 * die Stationszeit. Felder mit @db.Date speichert Prisma als UTC-Mitternacht – siehe dbDate/fromDbDate.
 */
import { INTL_LOCALE, type Locale } from '@/i18n/core'

export const pad = (n: number) => String(n).padStart(2, '0')
export const hm = (d: Date) => pad(d.getHours()) + ':' + pad(d.getMinutes())
export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}
export const minOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()

export function startOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export function addMinutes(d: Date, n: number) {
  return new Date(d.getTime() + n * 60_000)
}
export function atTime(day: Date, time: string) {
  const x = startOfDay(day)
  const m = toMin(time)
  x.setHours(Math.floor(m / 60), m % 60, 0, 0)
  return x
}
export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** Lokales Kalenderdatum → Wert für @db.Date-Felder. */
export function dbDate(d: Date) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}
/** @db.Date-Wert → lokale Mitternacht. */
export function fromDbDate(d: Date) {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
export const dateKey = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
export const parseDateKey = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** Alter aus einem @db.Date-Geburtsdatum. */
export function age(birth: Date, now = new Date()) {
  const b = fromDbDate(birth)
  let a = now.getFullYear() - b.getFullYear()
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--
  return a
}

export function fmtDate(d: Date, locale: Locale, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], opts).format(d)
}
export const fmtDayMonth = (d: Date) => pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.'
export const fmtDbDate = (d: Date, locale: Locale) => fmtDate(fromDbDate(d), locale)

/** "heute 14:05", "gestern 08:10" oder "12.10. 09:30". */
export function fmtRel(d: Date, labels: { today: string; yesterday: string }, now = new Date()) {
  if (sameDay(d, now)) return labels.today + ' ' + hm(d)
  if (sameDay(d, addDays(now, -1))) return labels.yesterday + ' ' + hm(d)
  return fmtDayMonth(d) + ' ' + hm(d)
}

export function weekdayShort(d: Date, locale: Locale) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'short' }).format(d).replace('.', '')
}

export function fmtNum(v: number | null | undefined, dec: number, locale: Locale) {
  if (v == null) return '–'
  return new Intl.NumberFormat(INTL_LOCALE[locale], { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v)
}

// ── Schichten ──

export type ShiftDef = { code: string; name: string; start: string; end: string }

/** Schicht, die zum Zeitpunkt läuft. Überlappungen: die später begonnene gewinnt. */
export function shiftAt(shifts: ShiftDef[], d = new Date()): ShiftDef | null {
  const m = minOfDay(d)
  const running = shifts.filter((s) => inWindow(m, s.start, s.end))
  if (!running.length) return null
  return running.sort((a, b) => {
    const da = (m - toMin(a.start) + 1440) % 1440
    const db = (m - toMin(b.start) + 1440) % 1440
    return da - db
  })[0]
}

export function inWindow(min: number, from: string, to: string) {
  const a = toMin(from)
  const b = toMin(to)
  return a < b ? min >= a && min < b : min >= a || min < b
}

/** Beginn und Ende der Schicht, die am Kalendertag `day` beginnt. */
export function shiftBounds(s: ShiftDef, day: Date) {
  const start = atTime(day, s.start)
  let end = atTime(day, s.end)
  if (end <= start) end = addDays(end, 1)
  return { start, end }
}

/** Grenzen der aktuell laufenden Schicht (Nachtdienst nach Mitternacht gehört zum Vortag). */
export function currentShiftBounds(s: ShiftDef, now = new Date()) {
  const today = shiftBounds(s, now)
  if (now >= today.start && now < today.end) return today
  const prev = shiftBounds(s, addDays(now, -1))
  if (now >= prev.start && now < prev.end) return prev
  return today
}
