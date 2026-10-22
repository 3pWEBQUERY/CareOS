/**
 * Smart Workflows (PRD §48): Regeln, die aus Messwerten und Assessments Folgeaufgaben ableiten.
 * Reine Logik ohne Datenbank – auf Server und Client nutzbar. Konfiguration in Organization.settings.workflows
 * (Admin → Klinische Konfiguration → Smart Workflows). Ausführung: `src/lib/workflows.ts`.
 */

export const WORKFLOW_RULES = ['vitalsRecheck', 'weightLoss', 'bradenRisk', 'woundStalled'] as const
export type WorkflowRule = (typeof WORKFLOW_RULES)[number]

export type WorkflowPolicy = {
  /** Auffälliger Vitalwert → Nachkontrolle nach `afterMin` Minuten. */
  vitalsRecheck: { enabled: boolean; afterMin: number }
  /** Gewichtsverlust ≥ `pct` % innert `days` Tagen → MNA-SF. */
  weightLoss: { enabled: boolean; pct: number; days: number }
  /** Braden ≤ `maxScore` → Lagerungsplan in der Pflegeplanung prüfen. */
  bradenRisk: { enabled: boolean; maxScore: number }
  /** Wundfläche nach `days` Tagen nicht um mindestens `minReductionPct` % kleiner → Wundevaluation. */
  woundStalled: { enabled: boolean; days: number; minReductionPct: number }
}

export const DEFAULT_WORKFLOWS: WorkflowPolicy = {
  vitalsRecheck: { enabled: true, afterMin: 60 },
  weightLoss: { enabled: true, pct: 5, days: 30 },
  bradenRisk: { enabled: true, maxScore: 12 },
  woundStalled: { enabled: true, days: 14, minReductionPct: 20 },
}

export const WORKFLOW_LIMITS = {
  vitalsRecheck: { afterMin: { min: 15, max: 480 } },
  weightLoss: { pct: { min: 2, max: 20 }, days: { min: 7, max: 180 } },
  bradenRisk: { maxScore: { min: 9, max: 18 } },
  woundStalled: { days: { min: 7, max: 42 }, minReductionPct: { min: 0, max: 50 } },
} as const

/** Nur so weit zurück werden Auslöser ausgewertet, damit beim Einschalten keine Flut alter Aufgaben entsteht. */
export const RULE_LOOKBACK_HOURS = { vitalsRecheck: 12, bradenRisk: 7 * 24 } as const

const num = (v: unknown, def: number, lim: { min: number; max: number }) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(lim.max, Math.max(lim.min, Math.round(n))) : def
}
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def)

/** Liest Organization.settings.workflows mit Standardwerten und Grenzen. */
export function workflowPolicy(settings: unknown): WorkflowPolicy {
  const s = obj(obj(settings).workflows)
  const D = DEFAULT_WORKFLOWS
  const L = WORKFLOW_LIMITS
  const v = obj(s.vitalsRecheck), w = obj(s.weightLoss), b = obj(s.bradenRisk), u = obj(s.woundStalled)
  return {
    vitalsRecheck: { enabled: bool(v.enabled, D.vitalsRecheck.enabled), afterMin: num(v.afterMin, D.vitalsRecheck.afterMin, L.vitalsRecheck.afterMin) },
    weightLoss: { enabled: bool(w.enabled, D.weightLoss.enabled), pct: num(w.pct, D.weightLoss.pct, L.weightLoss.pct), days: num(w.days, D.weightLoss.days, L.weightLoss.days) },
    bradenRisk: { enabled: bool(b.enabled, D.bradenRisk.enabled), maxScore: num(b.maxScore, D.bradenRisk.maxScore, L.bradenRisk.maxScore) },
    woundStalled: { enabled: bool(u.enabled, D.woundStalled.enabled), days: num(u.days, D.woundStalled.days, L.woundStalled.days), minReductionPct: num(u.minReductionPct, D.woundStalled.minReductionPct, L.woundStalled.minReductionPct) },
  }
}

/**
 * Gewichtsveränderung im Zeitfenster: frühester gegen letzten Wert der letzten `days` Tage.
 * null bei weniger als zwei Werten oder wenn sie weniger als 3 Tage auseinanderliegen (Tagesschwankung).
 */
export function weightChange(points: { at: Date; weight: number }[], days: number, now = new Date()) {
  const from = now.getTime() - days * 86_400_000
  const pts = points.filter((p) => p.at.getTime() >= from && p.at <= now && p.weight > 0).sort((a, b) => a.at.getTime() - b.at.getTime())
  if (pts.length < 2) return null
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (last.at.getTime() - first.at.getTime() < 3 * 86_400_000) return null
  return { from: first.weight, fromAt: first.at, to: last.weight, toAt: last.at, pct: ((last.weight - first.weight) / first.weight) * 100 }
}

export const woundArea = (e: { lengthMm: number | null; widthMm: number | null }) => (e.lengthMm != null && e.widthMm != null && e.lengthMm > 0 && e.widthMm > 0 ? e.lengthMm * e.widthMm : null)

/**
 * Stagnierende Wunde: Die letzte gemessene Fläche ist gegenüber der Messung von vor mindestens `days` Tagen
 * nicht um `minReductionPct` % kleiner geworden. Ohne zwei Messungen im nötigen Abstand: kein Befund.
 */
export function woundProgress(entries: { at: Date; lengthMm: number | null; widthMm: number | null }[], days: number, minReductionPct: number) {
  const m = entries.map((e) => ({ at: e.at, area: woundArea(e) })).filter((e): e is { at: Date; area: number } => e.area != null).sort((a, b) => a.at.getTime() - b.at.getTime())
  if (m.length < 2) return null
  const last = m[m.length - 1]
  const cut = last.at.getTime() - days * 86_400_000
  const ref = [...m].reverse().find((e) => e.at.getTime() <= cut)
  if (!ref) return null
  const reductionPct = ((ref.area - last.area) / ref.area) * 100
  return { stalled: reductionPct < minReductionPct, reductionPct, refAt: ref.at, lastAt: last.at, refArea: ref.area, lastArea: last.area }
}

/** Fälligkeit einer Regelaufgabe: frühestens `afterMin` nach dem Auslöser, nie vor jetzt (auf 5 Minuten gerundet). */
export function ruleDue(trigger: Date, afterMin: number, now = new Date()) {
  const want = trigger.getTime() + afterMin * 60_000
  const t = Math.max(want, now.getTime())
  return new Date(Math.ceil(t / 300_000) * 300_000)
}

/** Zeitraum-Index, damit eine Regel pro Wunde höchstens einmal je `days` Tage auslöst. */
export const periodIndex = (start: Date, at: Date, days: number) => Math.floor((at.getTime() - start.getTime()) / (days * 86_400_000))

/**
 * Fälligkeit für Regeln ohne Zeitdruck (Assessment, Planung, Wundevaluation): in der Tagschicht,
 * frühestens eine Stunde nach jetzt; nachts erzeugte Aufgaben werden auf 10:00 gelegt.
 */
export function dayTimeDue(now = new Date()) {
  const d = ruleDue(now, 60, now)
  if (d.getHours() < 8) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0)
  if (d.getHours() >= 19) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 10, 0)
  return d
}
