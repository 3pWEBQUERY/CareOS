import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { EXTERNAL_PHYSICIAN, hasPermission, type Grant } from '@/lib/permissions'

const grantsOf = (roles: { unitId: string | null; locationId: string | null; role: { permissions: string[] } }[]): Grant[] =>
  roles.map((a) => ({ permissions: a.role.permissions, unitId: a.unitId, locationId: a.locationId }))

/** Konto ist Ärztin/Arzt: extern oder intern mit Verordnungsrecht (irgendwo in der Organisation). */
export async function physicianAccount(ctx: Pick<Ctx, 'org'>, userId: string) {
  const u = await db.user.findFirst({ where: { id: userId, orgId: ctx.org.id }, include: { roles: { include: { role: true } } } })
  if (!u) return null
  if (u.kind === EXTERNAL_PHYSICIAN) return u
  return hasPermission(grantsOf(u.roles), 'resident.medication.edit') ? u : null
}

/** Alle Ärztinnen und Ärzte der Organisation (Admin-Liste): externe Konten und interne mit Verordnungsrecht. */
export async function physicianAccounts(orgId: string) {
  const users = await db.user.findMany({
    where: { orgId, pendingSince: null, OR: [{ kind: EXTERNAL_PHYSICIAN }, { roles: { some: { role: { permissions: { has: 'resident.medication.edit' } } } } }] },
    include: { roles: { include: { role: true } } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  return users.filter((u) => u.kind === EXTERNAL_PHYSICIAN || hasPermission(grantsOf(u.roles), 'resident.medication.edit'))
}
