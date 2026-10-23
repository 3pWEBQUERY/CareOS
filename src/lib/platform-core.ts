/**
 * Plattform-Ebene (PRD §42) – reine Logik ohne Datenbank (Server-Teil: src/lib/platform.ts, Oberfläche /platform).
 */
import { z } from 'zod'
import { DATA_REGIONS } from './admin-shared'

/** PLATFORM_ADMIN_EMAILS: kommagetrennt, Gross-/Kleinschreibung egal. */
export function platformAdminEmails(env: Record<string, string | undefined>) {
  return [...new Set((env.PLATFORM_ADMIN_EMAILS ?? '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@')))]
}

export const isPlatformOperator = (u: { platformRole?: string | null; active?: boolean } | null | undefined) => !!u && u.active !== false && u.platformRole === 'operator'

export type OrgStatus = 'active' | 'pending' | 'suspended'
export const orgStatus = (o: { suspendedAt: Date | null; suspendedReason: string | null }): OrgStatus => (o.suspendedAt ? (o.suspendedReason === 'pending' ? 'pending' : 'suspended') : 'active')

/** Erlaubte Statuswechsel. Die eigene Organisation des Plattform-Betriebs kann nicht gesperrt werden (Aussperrung). */
export function canTransition(from: OrgStatus, to: 'approve' | 'suspend' | 'unsuspend', own: boolean) {
  if (to === 'suspend') return !own && from !== 'suspended'
  if (to === 'approve') return from === 'pending'
  return from === 'suspended'
}

export const platformOrgSchema = z.object({
  orgName: z.string().trim().min(2, 'tenancy.platform.create.badName').max(120, 'tenancy.platform.create.badName'),
  locationName: z.string().trim().max(120).optional().transform((v) => v || undefined),
  units: z.coerce.number().int().min(1).max(50),
  unitName: z.string().trim().max(60).optional().transform((v) => v || undefined),
  adminEmail: z.string().trim().toLowerCase().max(160).pipe(z.email('register.errors.email')),
  adminFirst: z.string().trim().min(1, 'register.errors.firstName').max(60, 'register.errors.firstName'),
  adminLast: z.string().trim().min(1, 'register.errors.lastName').max(60, 'register.errors.lastName'),
  dataRegion: z.enum(DATA_REGIONS),
})

/** Speicher lesbar (B, KB, MB, GB). */
export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}
