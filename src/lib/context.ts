import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { requireSession, requestMeta } from '@/lib/auth/session'
import { hasPermission, type Grant, type Permission } from '@/lib/permissions'
import { dictionary } from '@/i18n'
import { makeT, type Locale, type Terminology, type TFn } from '@/i18n/core'

export const UNIT_COOKIE = 'careos_unit'

export type Scope = { unitId?: string | null; locationId?: string | null }

export type Ctx = Awaited<ReturnType<typeof loadCtx>>

async function loadCtx() {
  const session = await requireSession()
  const user = session.user
  const [org, assignments, meta] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: user.orgId } }),
    db.roleAssignment.findMany({ where: { userId: user.id }, include: { role: true } }),
    requestMeta(),
  ])
  const grants: Grant[] = assignments.map((a) => ({ permissions: a.role.permissions, locationId: a.locationId, unitId: a.unitId }))
  const roleNames = [...new Set(assignments.map((a) => a.role.name))]

  const allUnits = await db.unit.findMany({
    where: { orgId: org.id },
    include: { location: { select: { id: true, name: true } } },
    orderBy: [{ location: { name: 'asc' } }, { name: 'asc' }],
  })
  const orgWide = grants.some((g) => !g.unitId && !g.locationId)
  const units = orgWide
    ? allUnits
    : allUnits.filter((u) => grants.some((g) => g.unitId === u.id || (g.locationId && g.locationId === u.locationId)))

  const jar = await cookies()
  const wanted = jar.get(UNIT_COOKIE)?.value
  const unit = units.find((u) => u.id === wanted) ?? units.find((u) => u.id === user.primaryUnitId) ?? units[0] ?? null

  const locale = user.locale as Locale
  const terminology = org.terminology as Terminology
  const t: TFn = makeT(dictionary(locale), locale, terminology)

  const can = (perm: Permission, scope?: Scope) => hasPermission(grants, perm, scope)
  /** Berechtigung im aktuell gewählten Bereich. */
  const canHere = (perm: Permission) => hasPermission(grants, perm, unit ? { unitId: unit.id, locationId: unit.locationId } : undefined)

  return {
    session,
    sessionId: session.id,
    user,
    org,
    grants,
    roleNames,
    units,
    unit,
    unitIds: units.map((u) => u.id),
    locale,
    terminology,
    t,
    can,
    canHere,
    ip: meta.ip,
    userAgent: meta.userAgent,
  }
}

/** Anfrage-Kontext: Benutzer, Organisation, Berechtigungen, Sprache. Pro Request einmal geladen. */
export const getCtx = cache(loadCtx)

export class ForbiddenError extends Error {
  constructor(public perm: string) {
    super('forbidden:' + perm)
  }
}

export function assertCan(ctx: Ctx, perm: Permission, scope?: Scope) {
  if (!ctx.can(perm, scope)) throw new ForbiddenError(perm)
}

/** Lädt einen Bewohner nur, wenn er im Zugriffsbereich liegt und die Leseberechtigung besteht. */
export async function residentInScope(ctx: Ctx, residentId: string, perm: Permission = 'resident.read') {
  const r = await db.resident.findFirst({
    where: { id: residentId, orgId: ctx.org.id, unitId: { in: ctx.unitIds } },
    include: { unit: true, room: true },
  })
  if (!r) return null
  if (!ctx.can(perm, { unitId: r.unitId, locationId: r.unit.locationId })) return null
  return r
}
