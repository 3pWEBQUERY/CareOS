import 'server-only'
import type { IncidentStage, Prisma } from '@prisma/client'
import type { Ctx } from '@/lib/context'
import type { TFn } from '@/i18n/core'
import { INCIDENT_TYPES, type WorkflowStep } from '@/lib/clinical-config'
import { addDays } from '@/lib/time'

/** Ereignis-Workflow (PRD §22): Ereignis → Sofortmassnahmen → Bewertung → Follow-up → Analyse → Abschluss. */
export const STAGES: IncidentStage[] = ['reported', 'immediate', 'assessment', 'followup', 'analysis', 'closed']
export const stageIndex = (s: IncidentStage) => STAGES.indexOf(s)
/** Stufen, die nur mit quality.manage erreicht oder bearbeitet werden dürfen. */
export const MANAGE_STAGES: IncidentStage[] = ['assessment', 'followup', 'analysis', 'closed']
export const SEVERITIES = ['none', 'minor', 'moderate', 'severe'] as const

/** Bereiche, in denen der Benutzer Ereignisse sehen darf (melden oder bearbeiten). */
export function qualityUnits(ctx: Ctx) {
  return ctx.units.filter((u) => {
    const scope = { unitId: u.id, locationId: u.locationId }
    return ctx.can('quality.report', scope) || ctx.can('quality.manage', scope)
  })
}
export const canManageUnit = (ctx: Ctx, unit: { id: string; locationId: string }) => ctx.can('quality.manage', { unitId: unit.id, locationId: unit.locationId })

/** Folgeprozess eines Ereignistyps. Fehlt der Schlüssel in der DB-Konfiguration, wird die Standardkonfiguration herangezogen. */
export function workflowSteps(type: { key: string; workflow: Prisma.JsonValue }): WorkflowStep[] {
  const fallback = INCIDENT_TYPES.find((x) => x.key === type.key)?.workflow ?? []
  const raw = Array.isArray(type.workflow) ? (type.workflow as unknown[]) : []
  return raw
    .map((s, i) => {
      const o = (s ?? {}) as Partial<WorkflowStep>
      const key = o.key ?? fallback.find((f) => f.title === o.title)?.key ?? `step${i + 1}`
      return {
        key,
        title: o.title ?? key,
        category: o.category ?? 'Qualität',
        offsetMin: Number(o.offsetMin) || 0,
        durationMin: Number(o.durationMin) || 10,
      }
    })
}

/** Titel einer Massnahme: Systemschritte tragen den Schlüssel `incident.<step>`. */
export function actionTitle(t: TFn, title: string) {
  if (title.startsWith('incident.')) return t('quality.workflow.' + title.slice(9))
  return title
}

// ───────── Aggregation (Muster) ─────────

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

type AggIncident = { occurredAt: Date; place: string | null; severity: string; nearMiss: boolean; residentId: string | null; type: { key: string; name: string } }

/** Anonymisierte Kennzahlen für den Quality Assistant: nur Zählungen, keine Namen, keine Zimmernummern, keine Freitexte. */
export function anonymisedAggregates(rows: AggIncident[], from: Date | null, to: Date) {
  const count = <K extends string>(f: (r: AggIncident) => K) => rows.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {})
  const perResident = count((r) => r.residentId ?? '-')
  delete perResident['-']
  const repeat = Object.values(perResident).filter((n) => n >= 2).length
  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  return {
    zeitraum: { von: from ? from.toISOString().slice(0, 10) : null, bis: to.toISOString().slice(0, 10) },
    total: rows.length,
    nachTyp: count((r) => r.type.name),
    nachTageszeit: count((r) => ({ night: 'Nacht 22–6', morning: 'Morgen 6–11', midday: 'Tag 11–17', evening: 'Abend 17–22' })[timeBucket(r.occurredAt)]),
    nachWochentag: count((r) => weekdays[r.occurredAt.getDay()]),
    nachOrt: count((r) => placeKind(r.place)),
    nachSchweregrad: count((r) => r.severity),
    beinaheEreignisse: rows.filter((r) => r.nearMiss).length,
    personenMitMehrerenEreignissen: repeat,
    personenMitEreignis: Object.keys(perResident).length,
  }
}

export type Hint = { tone: 'warn' | 'info'; text: string; href?: string }

/** Regelbasierte Musterhinweise. Immer verfügbar, ohne KI. */
export function patternHints(
  t: TFn,
  rows: (AggIncident & { resident: { id: string; firstName: string; lastName: string } | null })[],
  now = new Date(),
  showNames = (_id: string) => true,
  locale = 'de-CH',
): Hint[] {
  const hints: Hint[] = []
  const since30 = addDays(now, -30)
  // Mehrere Stürze derselben Person in 30 Tagen
  const falls = new Map<string, { n: number; name: string }>()
  for (const r of rows) {
    if (r.type.key !== 'fall' || !r.resident || r.occurredAt < since30) continue
    const e = falls.get(r.resident.id) ?? { n: 0, name: `${r.resident.lastName} ${r.resident.firstName}` }
    e.n++
    falls.set(r.resident.id, e)
  }
  for (const [id, e] of falls) {
    if (e.n >= 2) hints.push({ tone: 'warn', text: t('quality.hints.repeatFalls', { name: showNames(id) ? e.name : t('quality.hints.someone'), n: e.n }), href: showNames(id) ? `/residents/${id}` : undefined })
  }
  // Häufung nach Tageszeit
  if (rows.length >= 3) {
    const byTime = new Map<TimeBucket, number>()
    for (const r of rows) byTime.set(timeBucket(r.occurredAt), (byTime.get(timeBucket(r.occurredAt)) ?? 0) + 1)
    const [top, n] = [...byTime.entries()].sort((a, b) => b[1] - a[1])[0]
    if (n >= 3 && n / rows.length >= 0.5) hints.push({ tone: 'info', text: t('quality.hints.timeCluster', { n, total: rows.length, time: t('quality.timeOfDay.' + top) }) })
    // Häufung nach Ort
    const byPlace = new Map<PlaceKind, number>()
    for (const r of rows) {
      const k = placeKind(r.place)
      if (k !== 'unknown' && k !== 'other') byPlace.set(k, (byPlace.get(k) ?? 0) + 1)
    }
    const p = [...byPlace.entries()].sort((a, b) => b[1] - a[1])[0]
    if (p && p[1] >= 3 && p[1] / rows.length >= 0.4) hints.push({ tone: 'info', text: t('quality.hints.placeCluster', { n: p[1], total: rows.length, place: t('quality.places.' + p[0]) }) })
    // Häufung nach Wochentag
    const byWd = new Map<number, number>()
    for (const r of rows) byWd.set(r.occurredAt.getDay(), (byWd.get(r.occurredAt.getDay()) ?? 0) + 1)
    const w = [...byWd.entries()].sort((a, b) => b[1] - a[1])[0]
    if (rows.length >= 5 && w[1] >= 3 && w[1] / rows.length >= 0.4) hints.push({ tone: 'info', text: t('quality.hints.weekdayCluster', { n: w[1], total: rows.length, day: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(2026, 0, 4 + w[0])) }) })
  }
  // Zunahme eines Typs: letzte 30 Tage gegenüber den 30 Tagen davor
  const since60 = addDays(now, -60)
  const cur = new Map<string, { n: number; name: string }>()
  const prev = new Map<string, number>()
  for (const r of rows) {
    if (r.occurredAt >= since30) cur.set(r.type.key, { n: (cur.get(r.type.key)?.n ?? 0) + 1, name: r.type.name })
    else if (r.occurredAt >= since60) prev.set(r.type.key, (prev.get(r.type.key) ?? 0) + 1)
  }
  for (const [k, c] of cur) {
    const p = prev.get(k) ?? 0
    if (c.n >= 3 && c.n >= 2 * Math.max(1, p)) hints.push({ tone: 'warn', text: t('quality.hints.increase', { type: c.name, n: c.n, prev: p }) })
  }
  return hints
}

export function median(values: number[]) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Datum/Zeit im Format YYYY-MM-DDTHH:MM (DateTimeField) in Stationszeit. */
export function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
