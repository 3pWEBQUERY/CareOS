/**
 * Offline-Erfassung (PRD §39): gemeinsame Typen für Gerät (Outbox) und Server (Synchronisation).
 * Keine Abhängigkeiten – wird im Client-Bundle verwendet.
 */
export const OFFLINE_KINDS = ['note', 'vitals', 'task', 'intake'] as const
export type OfflineKind = (typeof OFFLINE_KINDS)[number]

/** Offline-Einträge höchstens 24 h auf dem Gerät, Lesestand höchstens 12 h. */
export const OUTBOX_MAX_AGE_MS = 24 * 3600_000
export const SNAPSHOT_MAX_AGE_MS = 12 * 3600_000
/** Toleranz für abweichende Geräteuhren. */
export const FUTURE_SKEW_MS = 5 * 60_000

/** Muss OBS_CATEGORIES in residents/_lib/resident.ts entsprechen. */
export const NOTE_CATEGORIES = ['care', 'observation', 'physician', 'relatives', 'incident', 'handover'] as const

export type NoteData = { category: string; text: string; important: boolean }
export type VitalsData = { values: Record<string, number>; note?: string | null }
export type TaskData = { taskId: string; status: 'done' | 'partial' | 'skipped'; reason?: string; note?: string }
export type IntakeData = { type: 'drink'; ml: number; item?: string } | { type: 'meal'; meal: string; portion: number } | { type: 'fluid'; fluid: string; ml: number; item?: string }

export type OfflineOpInput =
  | { kind: 'note'; residentId: string; data: NoteData }
  | { kind: 'vitals'; residentId: string; data: VitalsData }
  | { kind: 'task'; residentId: string; data: TaskData }
  | { kind: 'intake'; residentId: string; data: IntakeData }

/** Ein Vorgang, wie er an /api/offline/sync gesendet wird. id = UUID = Idempotenzschlüssel, at = Zeitpunkt auf dem Gerät. */
export type OfflineOp = OfflineOpInput & { id: string; at: string }

export type OpStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected' | 'error'
export type ConflictReason =
  | 'taskClosed' | 'taskChanged' | 'taskNotFound' | 'medOnly' | 'discharged' | 'implausible'
  | 'invalid' | 'forbidden' | 'tooOld' | 'future' | 'idTaken' | 'error'
export type OpResult = { id: string; status: OpStatus; reason?: ConflictReason; detail?: Record<string, string> }

/** Anzeige-Metadaten, verschlüsselt zusammen mit den Daten gespeichert. */
export type OpMeta = { who?: string; label?: string }

/** Minimaler Lesestand der Schicht (keine Verlaufseinträge, keine Vitalwerte). */
export type ShiftSnapshot = {
  userId: string
  userName: string
  locale: string
  theme?: string
  unit: string | null
  savedAt: string
  residents: { id: string; name: string; room: string | null; allergies: string[]; rea: 'yes' | 'no' | 'unknown'; risks: string[]; absent: boolean }[]
  tasks: { id: string; residentId: string | null; time: string; title: string; med: boolean }[]
}
