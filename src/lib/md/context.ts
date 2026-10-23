import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, ForbiddenError, type Ctx } from '@/lib/context'
import { isExternalPhysician, type Permission } from '@/lib/permissions'
import { stripDisabled } from '@/lib/modules'
import { assignedWhere, mdPermissions } from './scope'

/**
 * Kontext des Ärzteportals /md (PRD §60). Baut auf der normalen Sitzung auf (getCtx: Sprache, Organisation, Audit),
 * ersetzt aber die Berechtigungen: feste Portalrechte statt Rollen, und der Bewohnerbezug entsteht ausschliesslich
 * über aktive Zuordnungen (`ResidentPhysician`). Einzige Stelle, an der das Portal Personen lädt.
 */
async function loadMdCtx() {
  const ctx = await getCtx()
  if (!isExternalPhysician(ctx.user)) redirect('/')
  const now = new Date()
  const perms = mdPermissions((p) => stripDisabled(p, ctx.modules))
  const rows = await db.resident.findMany({
    where: { orgId: ctx.org.id, status: { in: ['active', 'absent'] }, ...assignedWhere(ctx.user.id, now) },
    select: { id: true },
  })
  const residentIds = rows.map((r) => r.id)
  const can = (perm: Permission) => perms.includes(perm)
  return { ...ctx, perms, residentIds, can, canHere: can, md: true as const }
}

export type MdCtx = Awaited<ReturnType<typeof loadMdCtx>>
export const getMdCtx = cache(loadMdCtx)

/** Person nur mit aktiver Zuordnung, gleicher Organisation und Portalrecht laden (sonst null). */
export async function mdResidentInScope(md: MdCtx, residentId: string, perm: Permission = 'resident.read') {
  if (!md.can(perm) || !md.residentIds.includes(residentId)) return null
  return db.resident.findFirst({
    where: { id: residentId, orgId: md.org.id, ...assignedWhere(md.user.id) },
    include: { unit: true, room: true },
  })
}

/** Für Server Actions im Portal: wirft ForbiddenError (von run() abgefangen). */
export async function mdActionResident(residentId: string, perm: Permission) {
  const md = await getMdCtx()
  const r = await mdResidentInScope(md, residentId, perm)
  if (!r) throw new ForbiddenError(perm)
  return { md, r }
}

/** Gemeinsamer Teil von Ctx und MdCtx, den Daten-Helfer (Visite, Medikation) brauchen. */
export type BaseCtx = Pick<Ctx, 'org' | 'user' | 't' | 'locale' | 'sessionId' | 'ip' | 'userAgent'>
