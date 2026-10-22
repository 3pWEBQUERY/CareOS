/**
 * Datum und Uhrzeit für eigene Eingabefelder (DateField, TimeField, DateTimeField) – rein, ohne DOM,
 * auf Server und Client nutzbar. Werte bleiben im Formularformat wie bei den nativen Feldern:
 * `YYYY-MM-DD`, `HH:MM` (24 h), `YYYY-MM-DDTHH:MM`. Anzeige und Eingabe folgen der App-Sprache.
 */
import { INTL_LOCALE, type Locale } from '@/i18n/core'

export type DatePart = 'day' | 'month' | 'year'
export type DateParts = { order: DatePart[]; sep: string }

const pad2 = (n: number) => String(n).padStart(2, '0')

const partsCache = new Map<Locale, DateParts>()
/** Reihenfolge und Trennzeichen des numerischen Datums aus Intl (de/fr/it-CH: 31.01.2026, en-GB: 31/01/2026). */
export function dateParts(locale: Locale): DateParts {
  const hit = partsCache.get(locale)
  if (hit) return hit
  let out: DateParts = { order: ['day', 'month', 'year'], sep: '.' }
  try {
    const parts = new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
      .formatToParts(new Date(Date.UTC(2026, 10, 23)))
    const order = parts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => p.type as DatePart)
    const sep = parts.find((p) => p.type === 'literal')?.value.trim() || '.'
    if (order.length === 3) out = { order, sep }
  } catch { /* Standard behalten */ }
  partsCache.set(locale, out)
  return out
}

/** Platzhalter-Buchstaben je Sprache (Tag/Monat/Jahr). */
const LETTERS: Record<Locale, Record<DatePart, string>> = {
  de: { day: 'TT', month: 'MM', year: 'JJJJ' },
  fr: { day: 'JJ', month: 'MM', year: 'AAAA' },
  it: { day: 'GG', month: 'MM', year: 'AAAA' },
  en: { day: 'DD', month: 'MM', year: 'YYYY' },
}
/** "TT.MM.JJJJ", "JJ.MM.AAAA", "GG.MM.AAAA", "DD/MM/YYYY". */
export function datePlaceholder(locale: Locale) {
  const { order, sep } = dateParts(locale)
  return order.map((p) => LETTERS[locale][p]).join(sep)
}
export const TIME_PLACEHOLDER = 'HH:MM'

// ───────── ISO-Datum (YYYY-MM-DD) ─────────

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export const toIso = (y: number, m: number, d: number) => String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d)
export function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m, d]
}
export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = ymd(s)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}
export function isTime(s: string | null | undefined): s is string {
  return !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}
export function isIsoDateTime(s: string | null | undefined): s is string {
  return !!s && s.length === 16 && s[10] === 'T' && isIsoDate(s.slice(0, 10)) && isTime(s.slice(11))
}
/** Lokales Kalenderdatum (Stationszeit im Browser bzw. TZ des Servers). */
export const todayIso = (now = new Date()) => toIso(now.getFullYear(), now.getMonth() + 1, now.getDate())
export const nowTime = (now = new Date()) => pad2(now.getHours()) + ':' + pad2(now.getMinutes())

const utc = (iso: string) => {
  const [y, m, d] = ymd(iso)
  return new Date(Date.UTC(y, m - 1, d))
}
const fromUtc = (d: Date) => toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
export function addDaysIso(iso: string, n: number) {
  const d = utc(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return fromUtc(d)
}
/** Monate addieren; der Tag wird auf das Monatsende begrenzt (31.01. + 1 → 28./29.02.). */
export function addMonthsIso(iso: string, n: number) {
  const [y, m, d] = ymd(iso)
  const idx = y * 12 + (m - 1) + n
  const ny = Math.floor(idx / 12)
  const nm = (idx % 12) + 1
  return toIso(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}
/** Wochentag mit Montag = 0 … Sonntag = 6. */
export const weekdayMon = (iso: string) => (utc(iso).getUTCDay() + 6) % 7
export const startOfWeekIso = (iso: string) => addDaysIso(iso, -weekdayMon(iso))
export const endOfWeekIso = (iso: string) => addDaysIso(iso, 6 - weekdayMon(iso))

/** Kalenderblatt: 6 Wochen à 7 Tage ab dem Montag vor dem Monatsersten (feste Höhe beim Blättern). */
export function monthGrid(y: number, m: number): string[][] {
  const start = startOfWeekIso(toIso(y, m, 1))
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDaysIso(start, w * 7 + i)))
}

// ───────── Bereich (min/max) ─────────

/** 'min' | 'max', wenn der Wert ausserhalb liegt. Gleiches Format vorausgesetzt (ISO vergleicht lexikografisch). */
export function outOfRange(v: string, min?: string | null, max?: string | null): 'min' | 'max' | null {
  if (!v) return null
  if (min && v < min) return 'min'
  if (max && v > max) return 'max'
  return null
}
/** Begrenzt ein Datum auf min/max (für den Startpunkt im Kalender). */
export function clampIso(iso: string, min?: string | null, max?: string | null) {
  if (min && isIsoDate(min) && iso < min) return min
  if (max && isIsoDate(max) && iso > max) return max
  return iso
}

// ───────── Anzeige ─────────

/** ISO → "05.01.2026" (de/fr/it) bzw. "05/01/2026" (en); ungültig → ''. */
export function formatDate(iso: string | null | undefined, locale: Locale) {
  if (!isIsoDate(iso)) return ''
  const [y, m, d] = ymd(iso)
  const v: Record<DatePart, string> = { day: pad2(d), month: pad2(m), year: String(y) }
  const { order, sep } = dateParts(locale)
  return order.map((p) => v[p]).join(sep)
}
export function formatDateTime(v: string | null | undefined, locale: Locale) {
  if (!isIsoDateTime(v)) return ''
  return formatDate(v.slice(0, 10), locale) + ' ' + v.slice(11)
}
/** "Donnerstag, 22. Oktober 2026" – für Screenreader im Kalender. */
export function fullDateLabel(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: 'full', timeZone: 'UTC' }).format(utc(iso))
}
/** "Oktober 2026". */
export function monthLabel(y: number, m: number, locale: Locale) {
  const s = new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
  return s.charAt(0).toUpperCase() + s.slice(1)
}
/** Wochentage ab Montag: kurz ("Mo", "lun", "Mon") und lang ("Montag"). */
export function weekdayNames(locale: Locale) {
  const short = new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'short', timeZone: 'UTC' })
  const long = new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'long', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 19 + i)) // 19.10.2026 = Montag
    const s = short.format(d).replace(/\.$/, '')
    return { short: s.charAt(0).toUpperCase() + s.slice(1), long: long.format(d) }
  })
}

// ───────── Eingabe ─────────

/** Kurzwahl in allen vier Sprachen (unabhängig von der App-Sprache), Wert = Tage ab heute. */
const DAY_WORDS: Record<string, number> = {
  heute: 0, today: 0, oggi: 0, "aujourd'hui": 0, aujourdhui: 0, auj: 0,
  morgen: 1, tomorrow: 1, domani: 1, demain: 1,
  gestern: -1, yesterday: -1, ieri: -1, hier: -1,
}
const NOW_WORDS = new Set(['jetzt', 'now', 'maintenant', 'adesso', 'ora'])

/** Zweistellige Jahre: bis 10 Jahre in die Zukunft im laufenden Jahrhundert, sonst im vorherigen (45 → 1945, 30 → 2030). */
function expandYear(s: string, today: string) {
  if (s.length === 4) return Number(s)
  if (s.length > 2) return NaN
  const yy = Number(s)
  const cur = ymd(today)[0]
  const century = Math.floor(cur / 100) * 100
  let y = century + yy
  if (y > cur + 10) y -= 100
  return y
}

/**
 * Tolerante Datumseingabe in der Reihenfolge der App-Sprache.
 * Akzeptiert z. B. "1.2.26", "01022026", "1/2", "12" (Tag im laufenden Monat), "heute", "+3", ISO "2026-02-01".
 * Rückgabe: ISO-Datum, '' für leer, null für ungültig.
 */
export function parseDate(input: string, locale: Locale, today = todayIso()): string | null {
  const s = input.trim().toLowerCase().replace(/[’`´]/g, "'")
  if (!s) return ''
  if (s in DAY_WORDS) return addDaysIso(today, DAY_WORDS[s])
  const rel = /^([+-])\s*(\d{1,3})$/.exec(s)
  if (rel) return addDaysIso(today, (rel[1] === '-' ? -1 : 1) * Number(rel[2]))
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (iso) return check(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const { order } = dateParts(locale)
  const [ty, tm] = ymd(today)
  const tokens = s.split(/[.\/\-\s,]+/).filter(Boolean)
  if (!tokens.length || tokens.length > 3 || !tokens.every((x) => /^\d+$/.test(x))) return null
  const v: Partial<Record<DatePart, string>> = {}
  if (tokens.length === 1) {
    const t = tokens[0]
    if (t.length <= 2) return check(ty, tm, Number(t))
    const noYear = order.filter((p) => p !== 'year')
    if (t.length === 4) { v[noYear[0]] = t.slice(0, 2); v[noYear[1]] = t.slice(2) }
    else if (t.length === 6 || t.length === 8) {
      const yl = t.length - 4
      let i = 0
      for (const p of order) { const l = p === 'year' ? yl : 2; v[p] = t.slice(i, i + l); i += l }
    } else return null
  } else if (tokens.length === 2) {
    const noYear = order.filter((p) => p !== 'year')
    v[noYear[0]] = tokens[0]
    v[noYear[1]] = tokens[1]
  } else {
    order.forEach((p, i) => { v[p] = tokens[i] })
  }
  if ((v.day && v.day.length > 2) || (v.month && v.month.length > 2)) return null
  const y = v.year == null ? ty : expandYear(v.year, today)
  return check(y, Number(v.month), Number(v.day))
}
function check(y: number, m: number, d: number) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1800 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null
  return toIso(y, m, d)
}

/**
 * Tolerante Zeiteingabe, 24 h: "7:30", "07.30", "730", "0730", "7", "17h30", "17 Uhr", "jetzt".
 * Rückgabe: "HH:MM", '' für leer, null für ungültig.
 */
export function parseTime(input: string, now = new Date()): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!s) return ''
  if (NOW_WORDS.has(s)) return nowTime(now)
  let h: number
  let m: number
  const sep = /^(\d{1,2}) ?[:.,h] ?(\d{2})? ?(?:h|uhr)?$/.exec(s)
  const digits = /^(\d{1,4}) ?(?:h|uhr)?$/.exec(s)
  if (sep) {
    h = Number(sep[1])
    m = sep[2] ? Number(sep[2]) : 0
  } else if (digits) {
    const d = digits[1]
    if (d.length <= 2) { h = Number(d); m = 0 }
    else { h = Number(d.slice(0, d.length - 2)); m = Number(d.slice(-2)) }
  } else return null
  if (h > 23 || m > 59) return null
  return pad2(h) + ':' + pad2(m)
}

/** Auswahlzeiten im Raster (Standard 15 Min.), optional begrenzt. `stepMin` < 1 wird zu 15. */
export function timeOptions(stepMin = 15, min?: string | null, max?: string | null) {
  const step = stepMin >= 1 ? Math.round(stepMin) : 15
  const out: string[] = []
  for (let t = 0; t < 24 * 60; t += step) {
    const v = pad2(Math.floor(t / 60)) + ':' + pad2(t % 60)
    if (!outOfRange(v, min, max)) out.push(v)
  }
  return out
}
/** Index der ersten Option ≥ Wert (sonst die letzte). */
export function nearestIndex(options: string[], v: string) {
  if (!options.length) return -1
  const i = options.findIndex((o) => o >= v)
  return i < 0 ? options.length - 1 : i
}
