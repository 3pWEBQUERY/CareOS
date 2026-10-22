/**
 * Labor-Schnittstelle (PRD §40) – reine Logik: Format eingehender Befunde prüfen und Beurteilung ableiten.
 * Eingang: POST /api/v1/labs (Scope labs:write) oder Admin → Integrationen → Labor → Befunde importieren.
 * Ein Befund wird über (Integration, externalId) dedupliziert; Korrekturen des Labors kommen als neuer Befund.
 */
import { z } from 'zod'

export const LAB_FLAGS = ['normal', 'low', 'high', 'critical', 'abnormal'] as const
export type LabFlag = (typeof LAB_FLAGS)[number]

export const LabItem = z.object({
  /** CareOS-Kennung der Person oder Versichertennummer */
  residentId: z.string().min(1).max(64).optional(),
  insuranceNo: z.string().min(3).max(64).optional(),
  externalId: z.string().min(1).max(120).optional(),
  code: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(120),
  value: z.union([z.string().trim().min(1).max(60), z.number()]),
  unit: z.string().trim().max(30).optional(),
  refRange: z.string().trim().max(60).optional(),
  flag: z.enum(LAB_FLAGS).optional(),
  collectedAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().max(500).optional(),
}).refine((x) => x.residentId || x.insuranceNo, { message: 'residentId or insuranceNo required', path: ['residentId'] })

export const LabPayload = z.array(LabItem).min(1).max(500)
export type LabItemInput = z.infer<typeof LabItem>

/** Zahl aus Wert («5,4», «< 0.5» → 0.5), sonst null. */
export function numericValue(v: string | number): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = /^[<>≤≥]?\s*(-?\d+(?:[.,]\d+)?)$/.exec(v.trim())
  return m ? Number(m[1].replace(',', '.')) : null
}

/** Referenzbereich «3.5-5.1», «3,5 – 5,1», «< 5», «> 60». */
export function parseRange(r?: string | null): { lo: number | null; hi: number | null } | null {
  if (!r) return null
  const s = r.replace(/,/g, '.').trim()
  let m = /^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/.exec(s)
  if (m) return { lo: Number(m[1]), hi: Number(m[2]) }
  m = /^[<≤]\s*(-?\d+(?:\.\d+)?)$/.exec(s)
  if (m) return { lo: null, hi: Number(m[1]) }
  m = /^[>≥]\s*(-?\d+(?:\.\d+)?)$/.exec(s)
  if (m) return { lo: Number(m[1]), hi: null }
  return null
}

/** Beurteilung: Angabe des Labors hat Vorrang, sonst aus Referenzbereich. */
export function labFlag(item: { flag?: LabFlag | null; value: string | number; refRange?: string | null }): LabFlag | null {
  if (item.flag) return item.flag
  const n = numericValue(item.value)
  const r = parseRange(item.refRange)
  if (n == null || !r) return null
  if (r.lo != null && n < r.lo) return 'low'
  if (r.hi != null && n > r.hi) return 'high'
  return 'normal'
}
