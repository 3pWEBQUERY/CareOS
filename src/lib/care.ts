/**
 * Pflege (CareOS Plan, Assess, Wounds, Nutrition): gemeinsame, reine Hilfen für Server und Client.
 * Gespeicherte Werte (Kategorien, Wundarten …) bleiben stabil; die Anzeige läuft über i18n-Schlüssel.
 */
import { CARE_DOMAINS, type AssessmentDef } from '@/lib/clinical-config'
import type { TFn } from '@/i18n/core'

/** Kategorien von Massnahmen. `value` wird gespeichert (Aufgaben, Auswertungen), `key` dient der Übersetzung. */
export const IV_CATEGORIES = [
  { key: 'basic', value: 'Grundpflege', tone: '' },
  { key: 'treatment', value: 'Behandlungspflege', tone: 'accent' },
  { key: 'medication', value: 'Medikation', tone: 'violet' },
  { key: 'nutrition', value: 'Ernährung', tone: '' },
  { key: 'mobility', value: 'Mobilität', tone: '' },
  { key: 'monitoring', value: 'Überwachung', tone: 'warn' },
  { key: 'activation', value: 'Aktivierung', tone: 'ok' },
] as const

export const categoryKey = (value: string) => IV_CATEGORIES.find((c) => c.value === value)?.key
export const categoryTone = (value: string) => IV_CATEGORIES.find((c) => c.value === value)?.tone ?? ''
export function categoryLabel(t: TFn, value: string) {
  const k = categoryKey(value)
  return k ? t('care.categories.' + k) : value
}

const DOMAIN_KEYS = new Set<string>(CARE_DOMAINS.map((d) => d.key))
/** Name eines Pflegebereichs. Von der Organisation umbenannte Bereiche behalten ihren eigenen Namen. */
export function domainLabel(t: TFn, key: string, dbName?: string | null) {
  const def = CARE_DOMAINS.find((d) => d.key === key)
  if (dbName && (!def || dbName !== def.de)) return dbName
  return DOMAIN_KEYS.has(key) ? t('care.domains.' + key) : dbName || key
}

const ASSESSMENT_KEYS = new Set(['braden', 'fallrisk', 'mna', 'nrs', 'barthel'])
export function assessmentLabel(t: TFn, key: string, dbName?: string | null) {
  return ASSESSMENT_KEYS.has(key) ? t('care.assessments.names.' + key) : dbName || key
}

export type Level = 'ok' | 'warn' | 'crit'
/** Bewertung eines gespeicherten Punktwerts anhand der Bereiche der Definition. */
export function levelFor(def: Pick<AssessmentDef, 'items'> | undefined, score: number | null | undefined): Level | null {
  if (!def || score == null) return null
  const r = def.items.ranges.find((x) => score >= x.min && score <= x.max)
  return r?.level ?? null
}

/** Wochentage 0 = Sonntag … 6 = Samstag; Anzeige ab Montag. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
export function weekdaysLabel(t: TFn, days: number[]) {
  if (!days.length || days.length === 7) return t('care.plan.daily')
  const names = t('common.weekdaysShort').split(',')
  return WEEK_ORDER.filter((d) => days.includes(d)).map((d) => names[d]).join(', ')
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
/** "7:30, 14:00 18:00" → ["07:30","14:00","18:00"]; ungültige Angaben ergeben null. */
export function parseTimes(raw: string): string[] | null {
  const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    const m = /^(\d{1,2})[:.h]?(\d{2})$/.exec(p)
    if (!m) return null
    const v = m[1].padStart(2, '0') + ':' + m[2]
    if (!TIME_RE.test(v)) return null
    if (!out.includes(v)) out.push(v)
  }
  return out.sort()
}

// ── Smart Suggestions (PRD §9.3) ──

export type SuggestionRule = {
  key: string
  domain: string
  category: string
  times: string[]
  weekdays: number[]
  durationMin: number
}

/** Regelbasierte Vorschläge. Titel und Hinweise stehen in care.suggest.<key>. */
export const SUGGESTION_RULES: Record<string, SuggestionRule> = {
  reposition: { key: 'reposition', domain: 'skin', category: 'Grundpflege', times: ['06:00', '10:00', '14:00', '18:00', '22:00', '02:00'], weekdays: [], durationMin: 10 },
  skincheck: { key: 'skincheck', domain: 'skin', category: 'Überwachung', times: ['07:00'], weekdays: [], durationMin: 5 },
  fallprevention: { key: 'fallprevention', domain: 'safety', category: 'Überwachung', times: ['21:00'], weekdays: [], durationMin: 5 },
  fluidchart: { key: 'fluidchart', domain: 'nutrition', category: 'Ernährung', times: ['14:30', '20:00'], weekdays: [], durationMin: 5 },
  weightweekly: { key: 'weightweekly', domain: 'nutrition', category: 'Überwachung', times: ['07:00'], weekdays: [1], durationMin: 5 },
  painassess: { key: 'painassess', domain: 'pain', category: 'Überwachung', times: ['08:00', '14:00', '20:00'], weekdays: [], durationMin: 5 },
  mobilisation: { key: 'mobilisation', domain: 'mobility', category: 'Mobilität', times: ['10:00', '16:00'], weekdays: [], durationMin: 15 },
  woundcare: { key: 'woundcare', domain: 'skin', category: 'Behandlungspflege', times: ['09:00'], weekdays: [], durationMin: 20 },
}

export type SuggestionSource = { assessmentKey: string; assessmentId: string; score: number | null; level: Level | null } | { wound: string }

/** Ermittelt passende Regeln aus den letzten Assessments und offenen Wunden. */
export function suggestionKeys(latest: Map<string, { id: string; score: number | null; level: Level | null }>, openWounds: { id: string }[]) {
  const out: { rule: SuggestionRule; reason: { kind: 'assessment'; key: string; score: number | null } | { kind: 'wound' }; sourceId: string }[] = []
  const add = (k: string, reason: (typeof out)[number]['reason'], sourceId: string) => out.push({ rule: SUGGESTION_RULES[k], reason, sourceId })
  const braden = latest.get('braden')
  if (braden && braden.score != null && braden.score <= 12) {
    add('reposition', { kind: 'assessment', key: 'braden', score: braden.score }, braden.id)
    add('skincheck', { kind: 'assessment', key: 'braden', score: braden.score }, braden.id)
  }
  const fall = latest.get('fallrisk')
  if (fall && (fall.level === 'crit' || fall.level === 'warn')) add('fallprevention', { kind: 'assessment', key: 'fallrisk', score: fall.score }, fall.id)
  const mna = latest.get('mna')
  if (mna && mna.score != null && mna.score <= 11) {
    add('fluidchart', { kind: 'assessment', key: 'mna', score: mna.score }, mna.id)
    add('weightweekly', { kind: 'assessment', key: 'mna', score: mna.score }, mna.id)
  }
  const nrs = latest.get('nrs')
  if (nrs && nrs.score != null && nrs.score >= 4) add('painassess', { kind: 'assessment', key: 'nrs', score: nrs.score }, nrs.id)
  const barthel = latest.get('barthel')
  if (barthel && barthel.score != null && barthel.score <= 60) add('mobilisation', { kind: 'assessment', key: 'barthel', score: barthel.score }, barthel.id)
  for (const w of openWounds.slice(0, 1)) add('woundcare', { kind: 'wound' }, w.id)
  return out
}

// ── Wunden ──

export const WOUND_KINDS = ['pressure', 'leg_ulcer', 'diabetic_foot', 'surgical', 'skin_tear', 'trauma', 'other'] as const
export const WOUND_ORIGINS = ['in_house', 'admitted', 'unknown'] as const
export const EXUDATE = ['none', 'low', 'moderate', 'high'] as const
export const TISSUE = ['epithelial', 'granulation', 'slough', 'necrosis', 'mixed'] as const
export const EDGE = ['intact', 'reddened', 'macerated', 'undermined', 'callused'] as const

/** Übersetzt einen gespeicherten Schlüssel; ältere Freitexte werden unverändert angezeigt. */
export function keyLabel(t: TFn, group: string, list: readonly string[], v: string | null | undefined) {
  if (!v) return '–'
  return list.includes(v) ? t(`care.wounds.${group}.${v}`) : v
}

export const woundArea = (l: number | null, w: number | null) => (l != null && w != null ? Math.round(l * w) : null)

// ── Ernährung ──

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type Meal = (typeof MEALS)[number]
export const PORTIONS = [0, 0.25, 0.5, 0.75, 1] as const
export const portionLabel = (p: number | null | undefined) =>
  p == null ? '–' : p === 0 ? '0' : p === 0.25 ? '¼' : p === 0.5 ? '½' : p === 0.75 ? '¾' : p === 1 ? '1' : String(p)
export const QUICK_ML = [100, 150, 200, 250] as const
