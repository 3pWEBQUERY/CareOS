/**
 * Aufgaben-Rückstand (PRD §12, §14): eine Regel für alle Ansichten (Navigation, Kennzahlen, Liste, Übergabe).
 *
 * - Überfällig = offen (geplant, in Bearbeitung oder eskaliert) und mehr als 15 Minuten nach Fälligkeit.
 *   Eskalierte Aufgaben zählen mit – «eskaliert» ist ein zusätzlicher Hinweis, kein eigener Zähler.
 * - Zeitgebundene Routineaufgaben (Pflegeplanung, Medikamenten-Zeitpunkte, wiederkehrende Aufgaben) gehören zu
 *   ihrer Schicht. Sie bleiben in der Folgeschicht sichtbar (Übergabe «Was ist noch offen?», Aufgaben «aus Vorschicht»)
 *   und werden danach automatisch als «nicht erledigt – übergeben» geschlossen (Task.autoClosed = 'shift_end').
 * - Einzelaufgaben (manuell, ärztliche Anordnung, Ereignis-Massnahmen, Folgeaufgaben, Assessments, Evaluationen)
 *   bleiben offen, bis sie dokumentiert sind, höchstens BACKLOG_DAYS Tage in Listen und Zählern.
 * Rein, ohne Datenbank – Server, Client und Tests.
 */
import { addDays, addMinutes, shiftBounds, startOfDay, type ShiftDef } from '@/lib/time'

export const OVERDUE_GRACE_MIN = 15
export const BACKLOG_DAYS = 7
const SLOT_SOURCES = ['careplan', 'medication', 'recurring'] as const

type TaskLike = { source: string; sourceId: string | null; status: string; dueAt: Date }

/** Zeitgebunden: Routine aus Plan oder Serie, die nach ihrer Schicht nicht mehr nachgeholt wird. */
export function isSlotBound(t: Pick<TaskLike, 'source' | 'sourceId'>) {
  if (!(SLOT_SOURCES as readonly string[]).includes(t.source)) return false
  // Evaluationen der Pflegeplanung bleiben fällig, bis sie durchgeführt sind
  return !(t.source === 'careplan' && t.sourceId?.startsWith('eval:'))
}

export const isOpenStatus = (s: string) => s === 'planned' || s === 'ready' || s === 'in_progress' || s === 'escalated'

/** Eine Zahl für «überfällig» (inkl. eskaliert). */
export function isOverdue(t: Pick<TaskLike, 'status' | 'dueAt'>, now = new Date()) {
  return isOpenStatus(t.status) && t.dueAt.getTime() < now.getTime() - OVERDUE_GRACE_MIN * 60_000
}

/**
 * Beginn der vorangehenden Schicht: Zeitgebundene Aufgaben, die davor fällig waren, haben ihre eigene und die
 * folgende Schicht hinter sich. Ohne Schichtmodell: 24 Stunden.
 */
export function backlogCutoff(types: ShiftDef[], now = new Date()) {
  if (!types.length) return new Date(now.getTime() - 24 * 3600_000)
  const occ: { start: Date; end: Date }[] = []
  for (const d of [-2, -1, 0]) for (const s of types) occ.push(shiftBounds(s, addDays(startOfDay(now), d)))
  occ.sort((a, b) => b.start.getTime() - a.start.getTime())
  const running = occ.find((o) => o.start <= now && now < o.end)
  const ref = running?.start ?? now
  const previous = occ.find((o) => o.start < ref)
  return previous?.start ?? new Date(now.getTime() - 24 * 3600_000)
}

/** Untere Grenze für Listen und Zähler (Einzelaufgaben). */
export const backlogFloor = (now = new Date()) => addDays(startOfDay(now), -BACKLOG_DAYS)

/** Gehört die offene Aufgabe noch in Listen und Zähler? */
export function inBacklogWindow(t: TaskLike, cutoff: Date, now = new Date()) {
  if (t.dueAt < backlogFloor(now)) return false
  return !isSlotBound(t) || t.dueAt >= cutoff
}

/** Soll der Job die Aufgabe als «nicht erledigt – übergeben» schliessen? */
export const shouldExpire = (t: TaskLike, cutoff: Date) => isOpenStatus(t.status) && isSlotBound(t) && t.dueAt < cutoff

/** Prisma-Bedingung «offen und überfällig» für Zähler (gleiche Regel wie isOverdue + inBacklogWindow). */
export function overdueWhere(cutoff: Date, now = new Date()) {
  return {
    status: { in: ['planned', 'ready', 'in_progress', 'escalated'] as ('planned' | 'ready' | 'in_progress' | 'escalated')[] },
    dueAt: { gte: backlogFloor(now), lt: addMinutes(now, -OVERDUE_GRACE_MIN) },
    OR: [
      { dueAt: { gte: cutoff } },
      { source: { notIn: [...SLOT_SOURCES] } },
      { source: 'careplan' as const, sourceId: { startsWith: 'eval:' } },
    ],
  }
}

/** Offene Aufgaben früherer Schichten, die noch in die Liste gehören (gleiche Regel). */
export function backlogWhere(cutoff: Date, before: Date, now = new Date()) {
  return {
    status: { in: ['planned', 'ready', 'in_progress', 'escalated'] as ('planned' | 'ready' | 'in_progress' | 'escalated')[] },
    dueAt: { gte: backlogFloor(now), lt: before },
    OR: [
      { dueAt: { gte: cutoff } },
      { source: { notIn: [...SLOT_SOURCES] } },
      { source: 'careplan' as const, sourceId: { startsWith: 'eval:' } },
    ],
  }
}

/** Minuten als «30 h 15 Min.» bzw. «45 Min.» (PRD §51 klare Einheiten). */
export function splitMinutes(min: number) {
  const m = Math.max(0, Math.round(min))
  return { h: Math.floor(m / 60), m: m % 60 }
}
