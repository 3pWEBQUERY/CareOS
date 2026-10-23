import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requestMeta } from '@/lib/auth/session'
import { dictionary } from '@/i18n'
import { makeT, type Locale, type Terminology, type TFn } from '@/i18n/core'
import { requirePortalSession } from './auth'
import { portalEnabled } from './module'
import { effectiveGrants, hasGrant, portalResident, type PortalGrant } from './policy'
import { PORTAL_RESIDENT_COOKIE } from './routing'

/**
 * Kontext des Angehörigenportals – die einzige Stelle, an der im Portal der Bezug zu Bewohnenden entsteht.
 * Nutzt nie getCtx() der Stationsapp: keine Rollen, keine Bereiche, nur die eigenen, angenommenen,
 * nicht widerrufenen Zugänge mit ihren wirksamen Freigaben.
 */
async function loadPortalCtx() {
  const session = await requirePortalSession()
  const account = session.account
  const [org, rows, meta] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: account.orgId } }),
    db.portalAccess.findMany({
      where: { accountId: account.id, orgId: account.orgId, revokedAt: null, acceptedAt: { not: null } },
      include: { resident: { select: { id: true, orgId: true, unitId: true, firstName: true, lastName: true, status: true, anonymisedAt: true, unit: { select: { name: true } }, room: { select: { number: true } } } } },
      orderBy: { createdAt: 'asc' },
    }),
    requestMeta(),
  ])
  const moduleOn = portalEnabled(org)
  const accesses = rows
    .filter((a) => a.resident.orgId === org.id)
    .map((a) => ({
      id: a.id,
      role: a.role,
      residentId: a.residentId,
      unitId: a.resident.unitId,
      resident: portalResident(a.resident),
      grants: effectiveGrants({ moduleOn, access: a, account, resident: a.resident }),
    }))
    .filter((a) => a.grants.length > 0)

  const jar = await cookies()
  const wanted = jar.get(PORTAL_RESIDENT_COOKIE)?.value
  const current = accesses.find((a) => a.id === wanted) ?? accesses[0] ?? null

  const locale = account.locale as Locale
  const t: TFn = makeT(dictionary(locale), locale, org.terminology as Terminology)
  return {
    session,
    sessionId: session.id,
    account,
    org,
    moduleOn,
    accesses,
    current,
    locale,
    t,
    can: (g: PortalGrant) => !!current && hasGrant(current.grants, g),
    ip: meta.ip,
    userAgent: meta.userAgent,
  }
}

export type PortalCtx = Awaited<ReturnType<typeof loadPortalCtx>>
export const getPortalCtx = cache(loadPortalCtx)

export class PortalForbidden extends Error {
  constructor(public grant: string) {
    super('portal_forbidden:' + grant)
  }
}

/** Für Aktionen: aktueller Zugang mit Freigabe, sonst PortalForbidden. */
export async function requireGrant(g: PortalGrant) {
  const p = await getPortalCtx()
  if (!p.current || !hasGrant(p.current.grants, g)) throw new PortalForbidden(g)
  return { p, access: p.current }
}

const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue))

/** Audit im Portal (PRD §36): jeder Zugriff und jede Änderung, Akteur = Portal-Konto (userId bleibt leer). */
export async function portalAudit(p: Pick<PortalCtx, 'org' | 'account' | 'sessionId' | 'ip' | 'userAgent'>, e: { action: string; entityType: string; entityId?: string | null; after?: unknown; before?: unknown; context?: Record<string, unknown> }) {
  await db.auditLog.create({
    data: {
      orgId: p.org.id,
      userId: null,
      sessionId: p.sessionId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: json(e.before),
      after: json(e.after),
      context: json({ portalAccountId: p.account.id, ...e.context }),
      ip: p.ip,
      userAgent: p.userAgent,
    },
  })
}
