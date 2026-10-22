import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

/** Wird geworfen, wenn eine Änderung die letzte Person mit Rollenverwaltung organisationsweit entfernen würde. */
export class LastAdminError extends Error {
  constructor() {
    super('last_admin')
  }
}

type Tx = Prisma.TransactionClient

/** Aktive Benutzer mit organisationsweiter Rolle, die "admin.roles" enthält (faktisch Systemadministration). */
export async function countOrgAdmins(tx: Tx, orgId: string) {
  const rows = await tx.roleAssignment.findMany({
    where: { unitId: null, locationId: null, role: { orgId, permissions: { has: 'admin.roles' } }, user: { active: true, orgId } },
    select: { userId: true },
  })
  return new Set(rows.map((r) => r.userId)).size
}

/**
 * Führt eine Änderung in einer Transaktion aus und rollt sie zurück, falls danach niemand mehr
 * organisationsweit Rollen verwalten kann (Schutz vor Aussperrung, PRD §37).
 */
export async function guardLastAdmin<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    const r = await fn(tx)
    if ((await countOrgAdmins(tx, orgId)) === 0) throw new LastAdminError()
    return r
  })
}

/** Organisationseinstellungen (Organization.settings) typisiert lesen. */
export type OrgSettings = {
  demo?: boolean
  requireMfaForAdmins?: boolean
  requireMfaForAll?: boolean
  coverage?: Record<string, number>
  [k: string]: unknown
}
export const orgSettings = (s: unknown): OrgSettings => (s && typeof s === 'object' && !Array.isArray(s) ? (s as OrgSettings) : {})
