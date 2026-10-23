/**
 * Zugriffsgrenze im Ärzteportal (PRD §60, §34): externe Ärztinnen und Ärzte sehen nur Personen, denen sie über
 * `ResidentPhysician` aktuell zugeordnet sind. Reine Logik ohne Datenbank (Server und Tests).
 */
import { EXTERNAL_PHYSICIAN_PERMISSIONS, type Permission } from '@/lib/permissions'

export type PhysicianAssignment = { residentId: string; userId: string; from: Date; until: Date | null }

export const PHYSICIAN_ROLES = ['primary', 'consultant'] as const
export type PhysicianRole = (typeof PHYSICIAN_ROLES)[number]

/** Zuordnung gilt ab `from` bis ausschliesslich `until` (Ablaufdatum). */
export function assignmentActive(a: Pick<PhysicianAssignment, 'from' | 'until'>, now = new Date()) {
  return a.from <= now && (!a.until || a.until > now)
}

/** Personen, auf die das Konto jetzt zugreifen darf (nur eigene, nur aktive Zuordnungen). */
export function assignedResidentIds(rows: PhysicianAssignment[], userId: string, now = new Date()): string[] {
  return [...new Set(rows.filter((a) => a.userId === userId && assignmentActive(a, now)).map((a) => a.residentId))]
}

/** Prisma-Bedingung für Personen mit aktiver Zuordnung (für `where` auf Resident). */
export function assignedWhere(userId: string, now = new Date()) {
  return { physicians: { some: { userId, from: { lte: now }, OR: [{ until: null }, { until: { gt: now } }] } } }
}

/**
 * Berechtigungen im Portal: feste, minimale Liste (keine Rollen), ohne Rechte abgeschalteter Module.
 * `enabled` filtert z. B. Medikation weg, wenn die Organisation das Modul nicht nutzt.
 */
export function mdPermissions(enabled: (perms: readonly string[]) => readonly string[] = (p) => p): Permission[] {
  const on = new Set(enabled(EXTERNAL_PHYSICIAN_PERMISSIONS))
  return EXTERNAL_PHYSICIAN_PERMISSIONS.filter((p) => on.has(p))
}

/** Darf das Portal-Konto die Person sehen? (beide Bedingungen: Zuordnung aktiv UND gleiche Organisation) */
export function mdMayAccess(input: { residentOrgId: string; orgId: string; assignedIds: readonly string[]; residentId: string }) {
  return input.residentOrgId === input.orgId && input.assignedIds.includes(input.residentId)
}
