/**
 * API-Tokens (PRD §40, §60 Developer Platform) – reine Logik ohne Datenbank.
 *
 * - Integrations-Tokens (Admin → Integrationen und API, `admin.integrations`): Scopes frei wählbar, optional befristet.
 * - Persönliche Tokens (Developer-Portal, `api.personal`): Ablaufdatum Pflicht (höchstens 365 Tage), Scopes nur,
 *   wenn die Person die zugehörigen Berechtigungen **organisationsweit** hat – die API liefert organisationsweit,
 *   ein Bereichs-Grant würde sonst erweitert. Die Prüfung läuft bei jedem Aufruf erneut (Rollenänderungen,
 *   abgeschaltete Module wirken sofort).
 */
import { z } from 'zod'
import { API_SCOPES, type ApiScope } from './admin-shared'
import type { Grant } from './permissions'

/** Berechtigungen, die ein persönliches Token für den Scope braucht (alle). */
export const SCOPE_PERMISSIONS: Record<ApiScope, readonly string[]> = {
  'residents:read': ['resident.read'],
  'tasks:read': ['task.read'],
  'tasks:write': ['task.manage', 'task.complete'],
  'observations:write': ['resident.chart.write'],
  'events:read': ['resident.read', 'task.read'],
  'fhir:read': ['resident.read'],
  'labs:write': ['admin.integrations'],
  'residents:adt': ['resident.edit'],
  'documents:write': ['resident.chart.write'],
}

/** Gültigkeit persönlicher Tokens in Tagen */
export const TOKEN_DAYS = [7, 30, 90, 365] as const
export const TOKEN_MAX_DAYS = 365

const orgWide = (grants: readonly Grant[], perm: string) => grants.some((g) => !g.unitId && !g.locationId && g.permissions.includes(perm))

/** Scopes, die eine Person für ein persönliches Token wählen darf. */
export function allowedScopes(grants: readonly Grant[]): ApiScope[] {
  return API_SCOPES.filter((s) => SCOPE_PERMISSIONS[s].every((p) => orgWide(grants, p)))
}

/** Fehlende Scopes eines Tokens gegenüber den aktuellen Berechtigungen (leer = in Ordnung). */
export function scopesBeyond(scopes: readonly string[], grants: readonly Grant[]): string[] {
  const ok = new Set<string>(allowedScopes(grants))
  return scopes.filter((s) => !ok.has(s))
}

export type TokenState = 'active' | 'expired' | 'revoked'
export function tokenState(t: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): TokenState {
  if (t.revokedAt) return 'revoked'
  if (t.expiresAt && t.expiresAt <= now) return 'expired'
  return 'active'
}

/** Ablauf ab jetzt (Tage, auf Maximum begrenzt). */
export const tokenExpiry = (days: number, now = new Date()) => new Date(now.getTime() + Math.min(Math.max(1, Math.round(days)), TOKEN_MAX_DAYS) * 86_400_000)

export const personalTokenSchema = z.object({
  name: z.string().trim().min(1, 'developer.errors.name').max(80, 'developer.errors.name'),
  days: z.coerce.number().int().refine((n) => (TOKEN_DAYS as readonly number[]).includes(n), 'developer.errors.days'),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'developer.errors.scopes'),
})
