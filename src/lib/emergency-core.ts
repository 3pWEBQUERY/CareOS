/**
 * Notfallzugriff («Break Glass», PRD §34/§37) – reine Logik ohne Datenbank.
 * Server-Teil: src/lib/emergency.ts, Oberfläche Admin → Notfallzugriff, Banner in der Shell.
 */
import { z } from 'zod'
import type { Grant } from './permissions'

/** Nur lesend: Akte, Medikation, Aufgaben, Übergaben. Schreiben bleibt den klinischen Rollen vorbehalten. */
export const EMERGENCY_PERMISSIONS = ['resident.read', 'resident.medication.read', 'task.read', 'handover.read'] as const

/** Erlaubte Dauern in Minuten (höchstens 4 Stunden). */
export const EMERGENCY_MINUTES = [30, 60, 120, 240] as const
export const EMERGENCY_MAX_MINUTES = 240
export const EMERGENCY_REASON_MIN = 20

export const emergencySchema = z.object({
  reason: z.string().trim().min(EMERGENCY_REASON_MIN, 'tenancy.emergency.errors.reason').max(500, 'tenancy.emergency.errors.reasonLong'),
  minutes: z.coerce.number().int().refine((n) => (EMERGENCY_MINUTES as readonly number[]).includes(n), 'tenancy.emergency.errors.minutes'),
  confirm: z.literal('on', 'tenancy.emergency.errors.confirm'),
})

export type EmergencyLike = { startedAt: Date; expiresAt: Date; endedAt: Date | null; endedById?: string | null }

/** Läuft der Zugriff zum Zeitpunkt `now`? */
export const emergencyActive = (a: EmergencyLike | null | undefined, now = new Date()) => !!a && !a.endedAt && a.expiresAt > now && a.startedAt <= now

/** Ablauf aus Start und Minuten, auf die Höchstdauer begrenzt. */
export function emergencyExpiry(start: Date, minutes: number) {
  return new Date(start.getTime() + Math.min(Math.max(1, Math.round(minutes)), EMERGENCY_MAX_MINUTES) * 60_000)
}

/** Zusätzlicher, organisationsweiter Grant während eines laufenden Zugriffs. */
export function emergencyGrant(a: EmergencyLike | null | undefined, now = new Date()): Grant | null {
  return emergencyActive(a, now) ? { permissions: [...EMERGENCY_PERMISSIONS], locationId: null, unitId: null } : null
}

/** Status für die Anzeige im Verlauf. */
export function emergencyStatus(a: EmergencyLike, now = new Date()): 'active' | 'ended' | 'expired' {
  // Vorzeitig beendet = mit Person; durch Ablauf geschlossen = ohne Person (closeExpiredEmergencies)
  if (a.endedAt) return a.endedById ? 'ended' : 'expired'
  return a.expiresAt > now ? 'active' : 'expired'
}

/** Restdauer in Minuten (aufgerundet), 0 wenn abgelaufen. */
export const emergencyRemaining = (a: EmergencyLike, now = new Date()) => (emergencyActive(a, now) ? Math.ceil((a.expiresAt.getTime() - now.getTime()) / 60_000) : 0)
