'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { formObject } from '@/lib/registration-core'
import { setupOrganization } from '@/lib/org-setup'
import { issueLink } from '@/lib/invites'
import { MODULE_KEYS } from '@/lib/modules'
import { canTransition, orgStatus, platformOrgSchema } from '@/lib/platform-core'
import { platformAudit, setOrgModules } from '@/lib/platform'
import { platformAccess } from './access'

/** Plattform-Betrieb mit zweitem Faktor, sonst null. */
async function operator() {
  const a = await platformAccess()
  return a.ok && a.mfa ? a.ctx : null
}
const denied = { ok: false as const, error: 'tenancy.platform.noAccess' }

/** Neue Organisation (src/lib/org-setup.ts). Die Systemadministration setzt ihr Passwort über einen Einladungslink. */
export async function createOrgAction(form: FormData): Promise<ActionResult<{ secret: string; orgId: string }>> {
  return run(async () => {
    const ctx = await operator()
    if (!ctx) return denied
    const d = platformOrgSchema.parse(formObject(form))
    if (await db.user.findUnique({ where: { email: d.adminEmail }, select: { id: true } })) return { ok: false, error: 'tenancy.platform.create.emailTaken', field: 'adminEmail' }
    const modules = MODULE_KEYS.filter((k) => fdBool(form, 'module:' + k))
    const r = await setupOrganization(db, {
      source: 'platform', orgName: d.orgName, locationName: d.locationName, units: d.units, unitName: d.unitName, modules, dataRegion: d.dataRegion,
      admin: { email: d.adminEmail, firstName: d.adminFirst, lastName: d.adminLast, passwordHash: null, locale: ctx.locale },
    })
    if (!r) return { ok: false, error: 'common.genericError' }
    const link = await issueLink(r.adminId, 'invite')
    await platformAudit(ctx, r.orgId, 'platform.org.create', { after: { name: d.orgName, units: d.units, modules, dataRegion: d.dataRegion, adminEmail: d.adminEmail } })
    refresh()
    return { ok: true, data: { secret: link, orgId: r.orgId }, message: 'tenancy.platform.create.done' }
  })
}

async function transition(id: string, to: 'approve' | 'suspend' | 'unsuspend', reason?: string): Promise<ActionResult> {
  const ctx = await operator()
  if (!ctx) return denied
  const org = await db.organization.findUnique({ where: { id }, select: { id: true, name: true, suspendedAt: true, suspendedReason: true } })
  if (!org) return { ok: false, error: 'common.notFound' }
  const from = orgStatus(org)
  if (!canTransition(from, to, org.id === ctx.org.id)) return { ok: false, error: to === 'suspend' && org.id === ctx.org.id ? 'tenancy.platform.ownOrg' : 'common.genericError' }
  const data = to === 'suspend' ? { suspendedAt: new Date(), suspendedReason: reason || 'suspended' } : { suspendedAt: null, suspendedReason: null }
  // Bedingte Änderung: zwei Betreiber gleichzeitig ändern den Status nicht doppelt
  const r = await db.organization.updateMany({ where: { id, suspendedAt: org.suspendedAt }, data })
  if (!r.count) return { ok: false, error: 'common.genericError' }
  await platformAudit(ctx, id, 'platform.org.' + to, { before: { status: from, reason: org.suspendedReason }, after: { status: to === 'suspend' ? 'suspended' : 'active', reason: data.suspendedReason } })
  refresh()
  return { ok: true, message: to === 'approve' ? 'tenancy.platform.approved' : to === 'suspend' ? 'tenancy.platform.suspended' : 'tenancy.platform.unsuspended' }
}

export async function approveOrgAction(id: string): Promise<ActionResult> {
  return run(() => transition(id, 'approve'))
}

export async function unsuspendOrgAction(id: string): Promise<ActionResult> {
  return run(() => transition(id, 'unsuspend'))
}

/** Sperren mit Grund (nur Plattform sichtbar). Abgelehnte Anträge werden ebenfalls gesperrt. */
export async function suspendOrgAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const reason = z.string().trim().max(200).parse(fd(form, 'reason'))
    return transition(fd(form, 'id'), 'suspend', reason || undefined)
  })
}

export async function setOrgModulesAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await operator()
    if (!ctx) return denied
    const id = fd(form, 'id')
    if (!(await db.organization.findUnique({ where: { id }, select: { id: true } }))) return { ok: false, error: 'common.notFound' }
    const { before, after } = await setOrgModules(id, MODULE_KEYS.filter((k) => fdBool(form, 'module:' + k)))
    if (before.join() !== after.join()) await platformAudit(ctx, id, 'platform.org.modules', { before: { modules: before }, after: { modules: after } })
    refresh()
    return { ok: true, message: 'tenancy.platform.modulesSaved' }
  })
}
