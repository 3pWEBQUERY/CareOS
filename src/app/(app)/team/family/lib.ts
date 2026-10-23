import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ForbiddenError, type Ctx } from '@/lib/context'
import type { Permission } from '@/lib/permissions'
import { usersWithPermission } from '@/lib/notify'

/** Bereiche, in denen die Person eine Portal-Berechtigung hat. */
export function familyUnits(ctx: Ctx, perm: Permission = 'portal.respond') {
  return ctx.units.filter((u) => ctx.can(perm, { unitId: u.id, locationId: u.locationId }))
}

/** Bereichsfilter des Posteingangs: gewählter Bereich (Topbar) oder alle berechtigten Bereiche. */
export function inboxUnitIds(ctx: Ctx, all: boolean, perm: Permission = 'portal.respond') {
  const units = familyUnits(ctx, perm)
  if (!all && ctx.unit && units.some((u) => u.id === ctx.unit!.id)) return [ctx.unit.id]
  return units.map((u) => u.id)
}

export const residentInUnits = (orgId: string, unitIds: string[]): Prisma.ResidentWhereInput => ({ orgId, unitId: { in: unitIds } })

/** Gespräch bzw. Besuchsanfrage laden und Berechtigung im Bereich der Person prüfen. */
export async function threadInScope(ctx: Ctx, id: string, perm: Permission = 'portal.respond') {
  const th = await db.portalThread.findFirst({ where: { id, orgId: ctx.org.id }, include: { resident: { include: { unit: true, room: true } }, access: { include: { account: { select: { id: true, name: true, email: true, phone: true } } } } } })
  if (!th || !ctx.unitIds.includes(th.resident.unitId) || !ctx.can(perm, { unitId: th.resident.unitId, locationId: th.resident.unit.locationId })) return null
  return th
}

export async function visitInScope(ctx: Ctx, id: string, perm: Permission = 'portal.respond') {
  const v = await db.visitRequest.findFirst({ where: { id, orgId: ctx.org.id }, include: { resident: { include: { unit: true, room: true } }, access: { include: { account: { select: { id: true, name: true, email: true, phone: true } } } } } })
  if (!v || !ctx.unitIds.includes(v.resident.unitId) || !ctx.can(perm, { unitId: v.resident.unitId, locationId: v.resident.unit.locationId })) return null
  return v
}

export function assertFamily(ctx: Ctx, unitId: string, locationId: string, perm: Permission = 'portal.respond') {
  if (!ctx.can(perm, { unitId, locationId })) throw new ForbiddenError(perm)
}

/** Mögliche Zuständige: aktive Mitarbeitende mit portal.respond im Bereich. */
export async function assignees(orgId: string, unitId: string) {
  const ids = await usersWithPermission(orgId, 'portal.respond', unitId)
  return db.user.findMany({ where: { id: { in: ids }, orgId, active: true }, select: { id: true, firstName: true, lastName: true, jobTitle: true }, orderBy: { lastName: 'asc' } })
}

export const staffName = (u: { firstName: string; lastName: string }) => `${u.firstName.charAt(0)}. ${u.lastName}`
