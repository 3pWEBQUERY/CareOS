/**
 * Organisationseigene Vitalparameter (PRD §45, z. B. Bauchumfang, Peak-Flow, Bilirubin-Schnelltest).
 * Definition in Organization.settings.customVitals, Werte in VitalSign.extra ({ <key>: Zahl }). Server und Client.
 * Im Formular heissen die Felder `x_<key>`, damit sie nie mit den Standardparametern kollidieren.
 */
import { VITAL_KEYS } from '@/lib/vitals'

export type CustomVital = { key: string; label: string; unit: string; dec: number; min: number; max: number; lo: number | null; hi: number | null }
export const CUSTOM_PREFIX = 'x_'
export const CUSTOM_MAX = 8

const KEY_RE = /^[a-z][a-z0-9_]{1,30}$/

/** Schlüssel aus einer Bezeichnung (ohne Umlaute/Sonderzeichen). */
export function customKey(label: string) {
  return label.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'p$1').slice(0, 30)
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null)

/** Prüft und normalisiert Definitionen (Editor). Fehler sind i18n-Schlüssel mit Index. */
export function normalizeCustom(raw: unknown): { ok: true; defs: CustomVital[] } | { ok: false; error: string; index?: number } {
  if (!Array.isArray(raw)) return { ok: false, error: 'chart.custom.errors.invalid' }
  if (raw.length > CUSTOM_MAX) return { ok: false, error: 'chart.custom.errors.tooMany' }
  const out: CustomVital[] = []
  for (let i = 0; i < raw.length; i++) {
    const d = (raw[i] ?? {}) as Record<string, unknown>
    const label = String(d.label ?? '').trim().slice(0, 60)
    if (!label) return { ok: false, error: 'chart.custom.errors.label', index: i }
    const key = String(d.key ?? '').trim() || customKey(label)
    if (!KEY_RE.test(key) || (VITAL_KEYS as string[]).includes(key) || out.some((x) => x.key === key)) return { ok: false, error: 'chart.custom.errors.key', index: i }
    const unit = String(d.unit ?? '').trim().slice(0, 16)
    const dec = num(d.dec) ?? 0
    const min = num(d.min), max = num(d.max)
    if (min == null || max == null || min >= max) return { ok: false, error: 'chart.custom.errors.range', index: i }
    const lo = num(d.lo), hi = num(d.hi)
    if ((lo != null && (lo < min || lo > max)) || (hi != null && (hi < min || hi > max)) || (lo != null && hi != null && lo >= hi)) return { ok: false, error: 'chart.custom.errors.ref', index: i }
    out.push({ key, label, unit, dec: Math.min(2, Math.max(0, Math.round(dec))), min, max, lo, hi })
  }
  return { ok: true, defs: out }
}

/** Definitionen aus den Organisationseinstellungen; ungültige Einstellungen ergeben eine leere Liste. */
export function customVitals(settings: unknown): CustomVital[] {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).customVitals : null
  if (raw == null) return []
  const r = normalizeCustom(raw)
  return r.ok ? r.defs : []
}

export function customFlag(d: CustomVital, v: number | null | undefined): '' | 'lo' | 'hi' {
  if (v == null) return ''
  if (d.lo != null && v < d.lo) return 'lo'
  if (d.hi != null && v > d.hi) return 'hi'
  return ''
}

/** Werte aus Formularfeldern `x_<key>`: Plausibilität je Definition. */
export function parseCustom(get: (name: string) => string, defs: CustomVital[]): { values: Record<string, number> } | { error: { key: string; def: CustomVital; raw: string } } {
  const values: Record<string, number> = {}
  for (const d of defs) {
    const raw = get(CUSTOM_PREFIX + d.key).trim()
    if (!raw) continue
    const v = Number(raw.replace(',', '.'))
    if (!Number.isFinite(v) || v < d.min || v > d.max) return { error: { key: CUSTOM_PREFIX + d.key, def: d, raw } }
    values[d.key] = Number(v.toFixed(d.dec))
  }
  return { values }
}

/** VitalSign.extra lesen (nur Zahlen). */
export function readExtra(json: unknown): Record<string, number> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  return Object.fromEntries(Object.entries(json as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>
}
