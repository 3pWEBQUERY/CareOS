/**
 * Regelbasierte Mustererkennung für Qualitätsereignisse (PRD §22, §59) – ohne KI, reine Logik.
 * Hinweise nennen Personen nur, wenn die betrachtende Person deren Akte lesen darf (`showNames`).
 */
import type { TFn } from '@/i18n/core'
import { addDays } from '@/lib/time'

export type TimeBucket = 'night' | 'morning' | 'midday' | 'evening'
export function timeBucket(d: Date): TimeBucket {
  const h = d.getHours()
  if (h >= 22 || h < 6) return 'night'
  if (h < 11) return 'morning'
  if (h < 17) return 'midday'
  return 'evening'
}
export const TIME_BUCKETS: TimeBucket[] = ['morning', 'midday', 'evening', 'night']

export type PlaceKind = 'room' | 'bathroom' | 'corridor' | 'common' | 'outdoor' | 'other' | 'unknown'
/** Grobe Ortskategorie aus Freitext – für anonymisierte Auswertungen ohne Zimmernummern. */
export function placeKind(place: string | null | undefined): PlaceKind {
  const p = (place ?? '').toLowerCase()
  if (!p.trim()) return 'unknown'
  if (/\b(bad|wc|toilette|dusche|nasszelle|bagno|doccia|salle de bain|bathroom|toilet|shower)/.test(p)) return 'bathroom'
  if (/(zimmer|bett|chambre|lit\b|camera|letto|room|bed)/.test(p)) return 'room'
  if (/(flur|gang|korridor|treppe|lift|couloir|escalier|corridoio|scala|corridor|stairs|hall)/.test(p)) return 'corridor'
  if (/(aufenthalt|speise|ess|stube|cafeteria|salle|séjour|soggiorno|sala|lounge|dining|common)/.test(p)) return 'common'
  if (/(garten|terrasse|balkon|aussen|draussen|jardin|terrasse|giardino|terrazza|garden|outside|outdoor)/.test(p)) return 'outdoor'
  return 'other'
}
export const PLACE_KINDS: PlaceKind[] = ['room', 'bathroom', 'corridor', 'common', 'outdoor', 'other', 'unknown']

/** `action`: i18n-Schlüssel der Linkbeschriftung. */
export type Hint = { tone: 'warn' | 'info'; text: string; href?: string; action?: string; key: string }

export type PatternIncident = {
  occurredAt: Date
  place: string | null
  severity: string
  nearMiss: boolean
  residentId: string | null
  type: { key: string; name: string; id?: string }
  resident: { id: string; firstName: string; lastName: string } | null
}

/** Regeln und Schwellen (bewusst einfach und nachvollziehbar). */
export const PATTERN_RULES = {
  /** Stürze derselben Person */
  repeatFalls: { days: 30, min: 2 },
  /** Ereignisse derselben Person über alle Typen */
  repeatAny: { days: 30, min: 3 },
  /** Häufung nach Tageszeit, Ort, Wochentag: Mindestzahl und Anteil */
  cluster: { minTotal: 3, time: { n: 3, share: 0.5 }, place: { n: 3, share: 0.4 }, weekday: { total: 5, n: 3, share: 0.4 } },
  /** Zunahme eines Typs: letzte 30 Tage gegenüber den 30 Tagen davor */
  increase: { min: 3, factor: 2 },
} as const

/**
 * Regelbasierte Musterhinweise. `lastFallRisk`: Zeitpunkt der letzten gültigen Sturzrisiko-Einschätzung je Person
 * (für den Hinweis «nach wiederholtem Sturz nicht neu eingeschätzt»).
 */
export function patternHints(
  t: TFn,
  rows: PatternIncident[],
  now = new Date(),
  showNames = (_id: string) => true,
  locale = 'de-CH',
  lastFallRisk: Map<string, Date> = new Map(),
): Hint[] {
  const hints: Hint[] = []
  const R = PATTERN_RULES
  const listHref = (id: string) => `/quality?resident=${encodeURIComponent(id)}&period=90`
  const name = (id: string, r: { firstName: string; lastName: string }) => (showNames(id) ? `${r.lastName} ${r.firstName}` : t('quality.hints.someone'))

  // Mehrere Stürze derselben Person; ohne neue Sturzrisiko-Einschätzung seit dem ersten dieser Stürze zusätzlich ein Hinweis.
  const sinceFalls = addDays(now, -R.repeatFalls.days)
  const falls = new Map<string, { n: number; first: Date; r: { firstName: string; lastName: string } }>()
  for (const r of rows) {
    if (r.type.key !== 'fall' || r.nearMiss || !r.resident || r.occurredAt < sinceFalls) continue
    const e = falls.get(r.resident.id) ?? { n: 0, first: r.occurredAt, r: r.resident }
    e.n++
    if (r.occurredAt < e.first) e.first = r.occurredAt
    falls.set(r.resident.id, e)
  }
  for (const [id, e] of falls) {
    if (e.n < R.repeatFalls.min) continue
    const show = showNames(id)
    hints.push({ key: 'repeatFalls:' + id, tone: 'warn', text: t('quality.hints.repeatFalls', { name: name(id, e.r), n: e.n }), href: show ? listHref(id) : undefined, action: 'quality.hints.showIncidents' })
    const assessed = lastFallRisk.get(id)
    if (show && (!assessed || assessed < e.first)) hints.push({ key: 'fallRiskStale:' + id, tone: 'warn', text: t('quality.hints.fallRiskStale', { name: name(id, e.r) }), href: `/residents/${id}/assessments?k=fallrisk`, action: 'quality.hints.assess' })
  }

  // Mehrere Ereignisse derselben Person (alle Typen, ohne die bereits genannten Sturzserien)
  const sinceAny = addDays(now, -R.repeatAny.days)
  const anyBy = new Map<string, { n: number; types: Map<string, number>; r: { firstName: string; lastName: string } }>()
  for (const r of rows) {
    if (!r.resident || r.occurredAt < sinceAny) continue
    const e = anyBy.get(r.resident.id) ?? { n: 0, types: new Map(), r: r.resident }
    e.n++
    e.types.set(r.type.name, (e.types.get(r.type.name) ?? 0) + 1)
    anyBy.set(r.resident.id, e)
  }
  for (const [id, e] of anyBy) {
    if (e.n < R.repeatAny.min) continue
    if (e.types.size === 1 && falls.get(id)?.n === e.n) continue
    const list = [...e.types.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')
    hints.push({ key: 'repeatAny:' + id, tone: 'warn', text: t('quality.hints.repeatAny', { name: name(id, e.r), n: e.n, days: R.repeatAny.days, list }), href: showNames(id) ? listHref(id) : undefined, action: 'quality.hints.showIncidents' })
  }

  if (rows.length >= R.cluster.minTotal) {
    // Häufung nach Tageszeit
    const byTime = new Map<TimeBucket, number>()
    for (const r of rows) byTime.set(timeBucket(r.occurredAt), (byTime.get(timeBucket(r.occurredAt)) ?? 0) + 1)
    const [top, n] = [...byTime.entries()].sort((a, b) => b[1] - a[1])[0]
    if (n >= R.cluster.time.n && n / rows.length >= R.cluster.time.share) hints.push({ key: 'time:' + top, tone: 'info', text: t('quality.hints.timeCluster', { n, total: rows.length, time: t('quality.timeOfDay.' + top) }) })
    // Häufung nach Ort
    const byPlace = new Map<PlaceKind, number>()
    for (const r of rows) {
      const k = placeKind(r.place)
      if (k !== 'unknown' && k !== 'other') byPlace.set(k, (byPlace.get(k) ?? 0) + 1)
    }
    const p = [...byPlace.entries()].sort((a, b) => b[1] - a[1])[0]
    if (p && p[1] >= R.cluster.place.n && p[1] / rows.length >= R.cluster.place.share) hints.push({ key: 'place:' + p[0], tone: 'info', text: t('quality.hints.placeCluster', { n: p[1], total: rows.length, place: t('quality.places.' + p[0]) }) })
    // Häufung nach Wochentag
    const byWd = new Map<number, number>()
    for (const r of rows) byWd.set(r.occurredAt.getDay(), (byWd.get(r.occurredAt.getDay()) ?? 0) + 1)
    const w = [...byWd.entries()].sort((a, b) => b[1] - a[1])[0]
    if (rows.length >= R.cluster.weekday.total && w[1] >= R.cluster.weekday.n && w[1] / rows.length >= R.cluster.weekday.share) hints.push({ key: 'weekday:' + w[0], tone: 'info', text: t('quality.hints.weekdayCluster', { n: w[1], total: rows.length, day: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(2026, 0, 4 + w[0])) }) })
  }

  // Zunahme eines Typs: letzte 30 Tage gegenüber den 30 Tagen davor
  const since30 = addDays(now, -30)
  const since60 = addDays(now, -60)
  const cur = new Map<string, { n: number; name: string; id?: string }>()
  const prev = new Map<string, number>()
  for (const r of rows) {
    if (r.occurredAt >= since30) cur.set(r.type.key, { n: (cur.get(r.type.key)?.n ?? 0) + 1, name: r.type.name, id: r.type.id })
    else if (r.occurredAt >= since60) prev.set(r.type.key, (prev.get(r.type.key) ?? 0) + 1)
  }
  for (const [k, c] of cur) {
    const p = prev.get(k) ?? 0
    if (c.n >= R.increase.min && c.n >= R.increase.factor * Math.max(1, p)) hints.push({ key: 'increase:' + k, tone: 'warn', text: t('quality.hints.increase', { type: c.name, n: c.n, prev: p }), href: c.id ? `/quality?type=${encodeURIComponent(c.id)}&period=30` : undefined, action: 'quality.hints.showIncidents' })
  }
  return hints
}
