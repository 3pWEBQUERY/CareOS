import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { db } from '@/lib/db'
import { requireSession, requestMeta } from '@/lib/auth/session'
import { hasPermission, isExternalPhysician, type Grant, type Permission } from '@/lib/permissions'
import { dictionary } from '@/i18n'
import { makeT, type Locale, type Terminology, type TFn } from '@/i18n/core'
import { moduleOfPermission, normalizeModules, orgHasModule, stripDisabled, type ModuleKey } from '@/lib/modules'
import { emergencyGrant } from '@/lib/emergency-core'
import { activeEmergency, logEmergencyView } from '@/lib/emergency'

export const UNIT_COOKIE = 'careos_unit'

export type Scope = { unitId?: string | null; locationId?: string | null }

export type Ctx = Awaited<ReturnType<typeof loadCtx>>

async function loadCtx() {
  const session = await requireSession()
  const user = session.user
  const [org, assignments, meta, emergency] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: user.orgId } }),
    db.roleAssignment.findMany({ where: { userId: user.id }, include: { role: true } }),
    requestMeta(),
    activeEmergency(user.id),
  ])
  // Module (PRD §69): Berechtigungen abgeschalteter Module gelten nicht – Navigation, Seiten, Actions und Suche folgen.
  const modules = normalizeModules(org.modules)
  const grants: Grant[] = assignments.map((a) => ({ permissions: stripDisabled(a.role.permissions, modules), locationId: a.locationId, unitId: a.unitId }))
  const roleNames = [...new Set(assignments.map((a) => a.role.name))]
  // Notfallzugriff (PRD §34/§37): befristeter, organisationsweiter Lese-Grant; jeder Seitenaufruf wird protokolliert.
  const eg = emergencyGrant(emergency)
  if (eg) grants.push({ ...eg, permissions: stripDisabled(eg.permissions, modules) })
  // Externe Ärztinnen und Ärzte (Ärzteportal /md, PRD §60): in der Stationsapp keine Berechtigungen und keine Bereiche,
  // auch wenn versehentlich eine Rolle zugewiesen ist. Zugriff nur über getMdCtx() auf zugeordnete Personen.
  if (isExternalPhysician(user)) { grants.length = 0; roleNames.length = 0 }

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
  /** Modul aktiv? (auch §69-Paketnamen, siehe src/lib/modules.ts) */
  const hasModule = (key: Parameters<typeof orgHasModule>[1]) => orgHasModule(modules, key)

  if (eg && emergency) {
    const h = await headers()
    // Prefetches nicht protokollieren (keine tatsächliche Anzeige)
    if (!h.get('next-router-prefetch')) {
      await logEmergencyView({ accessId: emergency.id, orgId: org.id, userId: user.id, sessionId: session.id, path: h.get('x-careos-path') ?? '', ip: meta.ip, userAgent: meta.userAgent })
    }
  }

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
    modules,
    hasModule,
    /** Laufender Notfallzugriff (Banner in der Shell), sonst null */
    emergency: eg && emergency ? { id: emergency.id, expiresAt: emergency.expiresAt, startedAt: emergency.startedAt } : null,
    ip: meta.ip,
    userAgent: meta.userAgent,
  }
}

/** Anfrage-Kontext: Benutzer, Organisation, Berechtigungen, Sprache. Pro Request einmal geladen. */
export const getCtx = cache(loadCtx)

export class ForbiddenError extends Error {
  /** Gesetzt, wenn die Berechtigung zu einem abgeschalteten Modul gehört (Meldung «Modul nicht aktiv»). */
  moduleOff: ModuleKey | null = null
  constructor(public perm: string) {
    super('forbidden:' + perm)
  }
}

export function assertCan(ctx: Ctx, perm: Permission, scope?: Scope) {
  if (!ctx.can(perm, scope)) {
    const e = new ForbiddenError(perm)
    const m = moduleOfPermission(perm)
    if (m && !ctx.modules.includes(m)) e.moduleOff = m
    throw e
  }
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
