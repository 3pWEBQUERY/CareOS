/**
 * Löschkonzept und Aufbewahrungsfristen (PRD §36) – reine Logik ohne Server-Abhängigkeiten,
 * damit sie in Tests und im Admin-Formular verwendet werden kann.
 *
 * Standardwerte für den Schweizer Kontext. Aufbewahrungspflichten für Patientendokumentationen
 * sind kantonal geregelt (meist 10–20 Jahre nach Abschluss der Behandlung); die Werte sind
 * pro Organisation mit der Datenschutzberatung festzulegen.
 */
export type RetentionUnit = 'years' | 'months' | 'days'

export const RETENTION_CATEGORIES = ['clinical', 'chat', 'notifications', 'events', 'webhooks', 'ai', 'sessions', 'audit'] as const
export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number]

/** Was nach Ablauf geschieht: Bewohnerakten werden anonymisiert (Statistik bleibt erhalten), alles andere gelöscht. */
export const RETENTION_ACTION: Record<RetentionCategory, 'anonymise' | 'delete'> = {
  clinical: 'anonymise', chat: 'delete', notifications: 'delete', events: 'delete', webhooks: 'delete', ai: 'delete', sessions: 'delete', audit: 'delete',
}

export const RETENTION_RULES: Record<RetentionCategory, { unit: RetentionUnit; def: number; min: number; max: number }> = {
  clinical: { unit: 'years', def: 20, min: 10, max: 50 },
  chat: { unit: 'months', def: 24, min: 3, max: 120 },
  notifications: { unit: 'days', def: 90, min: 14, max: 730 },
  events: { unit: 'days', def: 90, min: 14, max: 730 },
  webhooks: { unit: 'days', def: 30, min: 7, max: 365 },
  ai: { unit: 'months', def: 12, min: 1, max: 60 },
  sessions: { unit: 'days', def: 30, min: 1, max: 365 },
  // Das Audit-Protokoll ist per Datenbank-Trigger mindestens 10 Jahre unveränderbar.
  audit: { unit: 'years', def: 10, min: 10, max: 30 },
}

export type RetentionPolicy = Record<RetentionCategory, number> & {
  /** Täglicher automatischer Lauf (02:30 Europe/Zurich). */
  auto: boolean
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  ...(Object.fromEntries(RETENTION_CATEGORIES.map((c) => [c, RETENTION_RULES[c].def])) as Record<RetentionCategory, number>),
  auto: true,
}

export const clampRetention = (c: RetentionCategory, v: unknown) => {
  const r = RETENTION_RULES[c]
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n)) return r.def
  return Math.min(r.max, Math.max(r.min, Math.round(n)))
}

/** Liest Organization.settings.retention, ergänzt Standardwerte und hält Mindestwerte ein. */
export function retentionPolicy(settings: unknown): RetentionPolicy {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).retention : null
  const raw = (s && typeof s === 'object' && !Array.isArray(s) ? s : {}) as Record<string, unknown>
  const out = { ...DEFAULT_RETENTION }
  for (const c of RETENTION_CATEGORIES) out[c] = clampRetention(c, raw[c])
  out.auto = typeof raw.auto === 'boolean' ? raw.auto : DEFAULT_RETENTION.auto
  return out
}

/** Kalendergenaues Zurückrechnen (Monatsende und 29. Februar werden auf den letzten gültigen Tag gekürzt). */
export function subtractPeriod(now: Date, n: number, unit: RetentionUnit): Date {
  if (unit === 'days') {
    const d = new Date(now)
    d.setDate(d.getDate() - n)
    return d
  }
  const months = unit === 'years' ? n * 12 : n
  const d = new Date(now)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() - months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return d
}

/** Stichtage je Kategorie: Datensätze vor diesem Zeitpunkt sind abgelaufen. */
export function retentionCutoffs(policy: RetentionPolicy, now = new Date()): Record<RetentionCategory, Date> {
  return Object.fromEntries(RETENTION_CATEGORIES.map((c) => [c, subtractPeriod(now, policy[c], RETENTION_RULES[c].unit)])) as Record<RetentionCategory, Date>
}

/** Geburtsdatum nach Anonymisierung: nur das Jahr bleibt (1. Januar, UTC-Mitternacht wie @db.Date). */
export const anonymisedBirthDate = (birth: Date) => new Date(Date.UTC(birth.getUTCFullYear(), 0, 1))

export const ANONYMISED_NAME = 'Anonymisiert'
export const DELETED_TEXT = '[gelöscht nach Aufbewahrungsfrist]'

// ───────────── Zeitplan: täglicher Lauf in einer bestimmten Zeitzone ─────────────

/** Versatz (ms) der Zeitzone gegenüber UTC zum Zeitpunkt d. */
function tzOffset(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - Math.floor(d.getTime() / 1000) * 1000
}

/** Lokale Wanduhrzeit (Jahr, Monat, Tag, HH:MM) in einer Zeitzone → UTC-Zeitpunkt. */
export function zonedTime(y: number, m: number, d: number, hh: number, mm: number, timeZone: string) {
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  let t = guess - tzOffset(new Date(guess), timeZone)
  t = guess - tzOffset(new Date(t), timeZone)
  return new Date(t)
}

/** Letzter fälliger Zeitpunkt eines täglichen Laufs (z. B. 02:30 Europe/Zurich) an oder vor now. */
export function lastDailySlot(now: Date, hhmm: string, timeZone = 'Europe/Zurich') {
  const [hh, mm] = hhmm.split(':').map(Number)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const today = zonedTime(get('year'), get('month'), get('day'), hh, mm, timeZone)
  if (today <= now) return today
  const prev = new Date(Date.UTC(get('year'), get('month') - 1, get('day') - 1))
  return zonedTime(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), hh, mm, timeZone)
}
