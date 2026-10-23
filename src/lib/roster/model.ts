/**
 * Dienstplanung (PEP-artige Monatsplanung). Rein, ohne Server-Abhängigkeiten – auf Server und Client nutzbar.
 *
 * Ein Plan ist ein Raster Person × Tag mit höchstens einem Dienst je Zelle (`Grid`, Schlüssel `userId|YYYY-MM-DD`).
 * Regeln (Ruhezeit, Arbeitstage am Stück, Nächte am Stück, Wochenstunden) prüft `evaluate`, `plan` füllt und repariert.
 */

import { STAFF_GROUPS, type StaffGroup } from './groups'

export type RType = { code: string; start: string; end: string; breakMinutes: number }
/**
 * Person in der Planung. Dauerhafte Vorgaben (User.shiftPrefs): `allowed` = nur diese Dienste (hart),
 * `preferred` = bevorzugte Dienste (weich), `maxNights` = höchstens so viele Nachtdienste im Monat (hart).
 */
export type RPerson = { id: string; name: string; pct: number; level: number; key: boolean; group?: StaffGroup; allowed?: string[]; preferred?: string[]; maxNights?: number | null }
export type ShiftPrefs = { allowed?: string[]; preferred?: string[]; maxNights?: number | null; group?: StaffGroup | null }

/**
 * Regeln je Dienstart (Organization.settings.shiftRules): `groups` = Funktionen, die den Dienst übernehmen dürfen
 * (leer = alle), `min` = Mindestanzahl je Funktion pro Tag (z. B. Frühdienst mind. 1 Pflegefachperson HF).
 */
export type ShiftRule = { groups?: StaffGroup[]; min?: Partial<Record<StaffGroup, number>> }

/** Vorgaben aus User.shiftPrefs lesen (unbekannte Codes und ungültige Werte verwerfen). */
export function readShiftPrefs(raw: unknown, codes: string[]): ShiftPrefs {
  const o = (raw ?? {}) as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && codes.includes(x)))] : [])
  const n = Number(o.maxNights)
  const group = typeof o.group === 'string' && (STAFF_GROUPS as readonly string[]).includes(o.group) ? (o.group as StaffGroup) : null
  return { allowed: list(o.allowed), preferred: list(o.preferred), maxNights: o.maxNights != null && Number.isInteger(n) && n >= 0 && n <= 31 ? n : null, group }
}

/** Regeln je Dienstart aus Organization.settings.shiftRules (unbekannte Gruppen und ungültige Zahlen verwerfen). */
export function readShiftRules(settings: unknown, codes: string[]): Record<string, ShiftRule> {
  const raw = ((settings ?? {}) as { shiftRules?: Record<string, { groups?: unknown; min?: Record<string, unknown> }> }).shiftRules ?? {}
  const out: Record<string, ShiftRule> = {}
  for (const c of codes) {
    const r = raw[c]
    if (!r) continue
    const groups = Array.isArray(r.groups) ? STAFF_GROUPS.filter((g) => (r.groups as unknown[]).includes(g)) : []
    const min: Partial<Record<StaffGroup, number>> = {}
    for (const g of STAFF_GROUPS) {
      const v = Number(r.min?.[g])
      if (Number.isInteger(v) && v > 0 && v <= 50) min[g] = v
    }
    out[c] = { ...(groups.length && groups.length < STAFF_GROUPS.length ? { groups } : {}), ...(Object.keys(min).length ? { min } : {}) }
  }
  return out
}
export type Cell = string | null
export type Grid = Record<string, Cell>
export type Wish = { kind: 'off' } | { kind: 'shift'; code: string }

export type RRules = {
  /** Wochenarbeitszeit bei 100 % */
  weeklyHours: number
  minRestHours: number
  maxConsecutiveDays: number
  maxConsecutiveNights: number
  maxWeeklyHours: number
  minFreeWeekends: number
  maxWishes: number
}

export const DEFAULT_RULES: RRules = {
  weeklyHours: 42,
  minRestHours: 11,
  maxConsecutiveDays: 6,
  maxConsecutiveNights: 5,
  maxWeeklyHours: 50,
  minFreeWeekends: 1,
  maxWishes: 8,
}

export const RULE_LIMITS: Record<keyof RRules, [number, number]> = {
  weeklyHours: [20, 50],
  minRestHours: [8, 16],
  maxConsecutiveDays: [3, 12],
  maxConsecutiveNights: [1, 10],
  maxWeeklyHours: [30, 60],
  minFreeWeekends: [0, 4],
  maxWishes: [0, 20],
}

/** Regeln aus Organization.settings.roster, fehlende oder ungültige Werte mit Standard. */
export function rosterRules(settings: unknown): RRules {
  const raw = ((settings ?? {}) as { roster?: Record<string, unknown> }).roster ?? {}
  const out = { ...DEFAULT_RULES }
  for (const k of Object.keys(DEFAULT_RULES) as (keyof RRules)[]) {
    const v = Number(raw[k])
    const [lo, hi] = RULE_LIMITS[k]
    if (raw[k] != null && Number.isFinite(v) && v >= lo && v <= hi) out[k] = v
  }
  return out
}

/**
 * Planungsaufgabe für einen Monat und Bereich. `before`/`after` sind bis zu 7 Tage Kontext ausserhalb des Monats
 * (Ruhezeit und Serien über die Monatsgrenze). Gesperrte Zellen (`locked`) ändert die Planung nie: vergangene Tage,
 * Kontexttage, Dienste in anderen Bereichen (`foreign`), laufende Tauschanfragen.
 */
export type RProblem = {
  days: string[]
  before: string[]
  after: string[]
  types: RType[]
  targets: Record<string, number>
  /** Wochentage (0 = So … 6 = Sa), an denen die Soll-Besetzung eines Dienstes gilt; fehlt = jeden Tag */
  targetDays?: Record<string, number[]>
  /** Soll-Besetzung je Wochentag (Index 0 = So … 6 = Sa); hat Vorrang vor `targets`/`targetDays` */
  targetByDay?: Record<string, number[]>
  /** Wer darf welchen Dienst, Mindestbesetzung je Funktion */
  shiftRules?: Record<string, ShiftRule>
  people: RPerson[]
  /** Abwesenheiten: genehmigt oder beantragt */
  absent: Record<string, 'approved' | 'requested'>
  /** Genehmigte Abwesenheiten, die als Arbeitszeit gutgeschrieben werden (Ferien, Krankheit, Weiterbildung) */
  credit: Record<string, true>
  wishes: Record<string, Wish>
  locked: Record<string, Cell>
  /** Dienste in einem anderen Bereich – zählen für Regeln und Stunden, nicht für die Besetzung hier */
  foreign: Record<string, true>
  rules: RRules
}

export const cellKey = (userId: string, day: string) => `${userId}|${day}`

/** Darf eine Person (nach Funktion) diesen Dienst übernehmen? */
export const eligible = (p: Pick<RProblem, 'shiftRules'>, person: Pick<RPerson, 'group'> | undefined, code: string) => {
  const groups = p.shiftRules?.[code]?.groups
  return !groups?.length || (!!person?.group && groups.includes(person.group))
}

/** Soll-Besetzung eines Dienstes an einem Tag (Wochentage je Dienst beachtet). */
export function targetOn(p: Pick<RProblem, 'targets' | 'targetDays' | 'targetByDay'>, day: string, code: string) {
  const byDay = p.targetByDay?.[code]
  if (byDay?.length === 7) return byDay[weekday(day)]
  const days = p.targetDays?.[code]
  if (days && days.length && !days.includes(weekday(day))) return 0
  return p.targets[code] ?? 0
}

export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Dauer in Minuten (über Mitternacht korrekt). */
export function durationMin(t: Pick<RType, 'start' | 'end'>) {
  const a = toMin(t.start)
  const b = toMin(t.end)
  return b > a ? b - a : b + 1440 - a
}

/** Bezahlte Arbeitszeit in Stunden (Dauer − Pause). */
export const shiftHours = (t: RType) => Math.max(0, durationMin(t) - (t.breakMinutes || 0)) / 60

/** Nachtdienst: endet nach Mitternacht oder beginnt ab 20 Uhr. */
export const isNight = (t: Pick<RType, 'start' | 'end'>) => toMin(t.end) <= toMin(t.start) || toMin(t.start) >= 20 * 60

/** Ruhezeit in Stunden zwischen einem Dienst am Tag d und einem am Folgetag. */
export function restHours(a: Pick<RType, 'start' | 'end'>, b: Pick<RType, 'start' | 'end'>) {
  const endA = toMin(a.start) + durationMin(a)
  return (1440 + toMin(b.start) - endA) / 60
}

/** Wochentag eines Datumsschlüssels: 0 = Sonntag … 6 = Samstag (Kalenderdatum, ohne Zeitzone). */
export function weekday(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export const isWeekend = (day: string) => {
  const w = weekday(day)
  return w === 0 || w === 6
}

export function shiftDay(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, d + n))
  return x.toISOString().slice(0, 10)
}

/** Alle Tage eines Monats ("YYYY-MM"). */
export function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** Montag der ISO-Woche eines Tages. */
export const isoMonday = (day: string) => shiftDay(day, -((weekday(day) + 6) % 7))

/** Soll-Stunden je Arbeitstag (Mo–Fr) für ein Pensum. */
export const dailySoll = (rules: RRules, pct: number) => (rules.weeklyHours / 5) * (pct / 100)

/** Soll-Stunden im Zeitraum: Arbeitstage Mo–Fr × Tages-Soll. */
export function sollHours(rules: RRules, pct: number, days: string[]) {
  return days.filter((d) => !isWeekend(d)).length * dailySoll(rules, pct)
}

export const round1 = (n: number) => Math.round(n * 10) / 10
