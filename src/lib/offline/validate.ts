/**
 * Offline-Synchronisation (PRD §39): reine Prüfregeln (Server, Tests). Konflikte werden ausdrücklich
 * gemeldet statt still überschrieben.
 */
import { z } from 'zod'
import { FLUID_KINDS, FLUID_LIMITS } from '@/lib/fluid-balance'
import { VITALS, VITAL_KEYS, type VitalKey, type VitalRow } from '../vitals'
import { MEALS, PORTIONS } from '../care'
import { FUTURE_SKEW_MS, NOTE_CATEGORIES, OUTBOX_MAX_AGE_MS, type ConflictReason, type OfflineOp } from './types'

export { NOTE_CATEGORIES }

const base = {
  id: z.string().uuid(),
  residentId: z.string().min(1).max(40),
  at: z.string().datetime({ offset: true }),
}

export const opSchema = z.discriminatedUnion('kind', [
  z.object({
    ...base, kind: z.literal('note'),
    data: z.object({ category: z.enum(NOTE_CATEGORIES), text: z.string().trim().min(3).max(8000), important: z.boolean() }),
  }),
  z.object({
    ...base, kind: z.literal('vitals'),
    data: z.object({ values: z.record(z.string(), z.number()), note: z.string().max(500).nullish(), extra: z.record(z.string().max(40), z.number()).optional() }),
  }),
  z.object({
    ...base, kind: z.literal('task'),
    data: z.object({ taskId: z.string().min(1).max(40), status: z.enum(['done', 'partial', 'skipped']), reason: z.string().max(2000).optional(), note: z.string().max(4000).optional() }),
  }),
  z.object({
    ...base, kind: z.literal('intake'),
    data: z.discriminatedUnion('type', [
      z.object({ type: z.literal('drink'), ml: z.number().int().min(10).max(2000), item: z.string().max(120).optional() }),
      z.object({ type: z.literal('meal'), meal: z.enum(MEALS), portion: z.number().refine((p) => (PORTIONS as readonly number[]).includes(p)) }),
      // Flüssigkeitsbilanz: Einfuhr Infusion/Sonde, Ausfuhr (PRD §14)
      z.object({ type: z.literal('fluid'), fluid: z.enum(FLUID_KINDS), ml: z.number().int().min(FLUID_LIMITS.min).max(FLUID_LIMITS.max), item: z.string().max(120).optional() }),
    ]),
  }),
])

export const syncSchema = z.object({ ops: z.array(z.unknown()).max(50) })

/** Zeitfenster: nicht älter als 24 h, nicht mehr als 5 min in der Zukunft. */
export function checkTime(at: Date, now = new Date()): 'tooOld' | 'future' | null {
  if (Number.isNaN(at.getTime())) return 'tooOld'
  if (now.getTime() - at.getTime() > OUTBOX_MAX_AGE_MS) return 'tooOld'
  if (at.getTime() - now.getTime() > FUTURE_SKEW_MS) return 'future'
  return null
}

/** Gültiger Vorgang oder Ablehnungsgrund. Leichte Uhrabweichungen nach vorne werden auf «jetzt» gesetzt. */
export function parseOp(raw: unknown, now = new Date()): { op: OfflineOp; at: Date } | { id: string | null; reason: ConflictReason } {
  const p = opSchema.safeParse(raw)
  const id = typeof (raw as { id?: unknown })?.id === 'string' ? ((raw as { id: string }).id.slice(0, 64)) : null
  if (!p.success) return { id, reason: 'invalid' }
  const at = new Date(p.data.at)
  const time = checkTime(at, now)
  if (time) return { id, reason: time }
  return { op: p.data as OfflineOp, at: at > now ? now : at }
}

/** Vitalwerte wie online (recordVitals): Plausibilität, Blutdruck nur paarweise. */
export function validateVitals(values: Record<string, number>): { row: VitalRow } | { reason: 'implausible' | 'invalid' } {
  const row: VitalRow = {}
  for (const [k, v] of Object.entries(values)) {
    if (!(VITAL_KEYS as string[]).includes(k)) return { reason: 'invalid' }
    const p = VITALS[k as VitalKey]
    if (!Number.isFinite(v) || v < p.min || v > p.max) return { reason: 'implausible' }
    row[k as VitalKey] = p.dec ? Number(v.toFixed(p.dec)) : Math.round(v)
  }
  if ((row.sys == null) !== (row.dia == null)) return { reason: 'invalid' }
  if (row.sys != null && row.dia != null && row.dia >= row.sys) return { reason: 'implausible' }
  if (!Object.keys(row).length) return { reason: 'invalid' }
  return { row }
}

/** Bewohnende nach Austritt oder Tod: keine Dokumentation mehr aus der Offline-Warteschlange. */
export function residentConflict(r: { status: string }): 'discharged' | null {
  return r.status === 'discharged' || r.status === 'deceased' ? 'discharged' : null
}

export type TaskState = { status: string; source: string; completedById: string | null; completedAt: Date | null }

/**
 * Konflikt bei Aufgaben: bereits abgeschlossen (von wem, wann) oder nach der Offline-Erfassung
 * durch jemand anderen geändert. Eigener identischer Abschluss gilt als bereits übernommen.
 */
export function taskConflict(
  task: TaskState | null,
  input: { userId: string; status: string; at: Date },
  changedAfter?: { by: string; at: Date } | null,
): { status: 'conflict' | 'duplicate'; reason?: ConflictReason } | null {
  if (!task) return { status: 'conflict', reason: 'taskNotFound' }
  if (task.source === 'medication') return { status: 'conflict', reason: 'medOnly' }
  const closed = task.status === 'done' || task.status === 'partial' || task.status === 'skipped'
  if (closed) {
    if (task.completedById === input.userId && task.status === input.status) return { status: 'duplicate' }
    return { status: 'conflict', reason: 'taskClosed' }
  }
  if (changedAfter && changedAfter.at > input.at) return { status: 'conflict', reason: 'taskChanged' }
  return null
}
