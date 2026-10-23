'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { dateKey, parseDateKey } from '@/lib/time'
import { portalEnabled } from '@/lib/portal/module'
import { CONSENT_BY, normalizeGrants, residentVisible } from '@/lib/portal/policy'
import { normalizeEmail } from '@/lib/portal/invite-core'
import { accessSnap, revokeAccess, sendPortalInvite } from '@/lib/portal/manage'
import { actionResident } from '../../_lib/resident'

export type InviteResult = { url: string; expiresAt: string; mailed: boolean }

const schema = z.object({
  name: z.string().min(2, 'portal.errors.name').max(120),
  email: z.email('portal.errors.email').max(160),
  role: z.enum(['relative', 'legal_rep']),
  consentBy: z.enum(CONSENT_BY),
  consentName: z.string().min(2, 'portal.errors.consentName').max(120),
  consentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'portal.errors.consentAt'),
  consentNote: z.string().max(500),
})

/** Zum Portal einladen: Einwilligung erfassen (wer, wann, Umfang), Zugang anlegen, Einmal-Link erzeugen. */
export async function invitePortalAction(residentId: string, contactId: string, form: FormData): Promise<ActionResult<InviteResult>> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'portal.manage')
    if (!portalEnabled(ctx.org)) return { ok: false, error: 'portal.errors.module' }
    const full = await db.resident.findUniqueOrThrow({ where: { id: r.id }, select: { status: true, anonymisedAt: true } })
    if (!residentVisible(full)) return { ok: false, error: 'portal.errors.residentInactive' }
    const contact = await db.contact.findFirst({ where: { id: contactId, residentId: r.id } })
    if (!contact) return { ok: false, error: 'common.notFound' }
    const p = schema.parse({
      name: fd(form, 'name'), email: normalizeEmail(fd(form, 'email')), role: fd(form, 'role') || 'relative', consentBy: fd(form, 'consentBy'),
      consentName: fd(form, 'consentName'), consentAt: fd(form, 'consentAt'), consentNote: fd(form, 'consentNote'),
    })
    const scope = normalizeGrants(form.getAll('grants'))
    if (!scope.length) return { ok: false, error: 'portal.errors.grants', field: 'grants' }
    const consentAt = parseDateKey(p.consentAt)
    if (!consentAt || p.consentAt > dateKey(new Date())) return { ok: false, error: 'portal.errors.consentAt', field: 'consentAt' }
    const dupe = await db.portalAccess.findFirst({ where: { orgId: ctx.org.id, residentId: r.id, inviteEmail: p.email, revokedAt: null } })
    if (dupe) return { ok: false, error: 'portal.errors.duplicate', field: 'email' }

    const a = await db.portalAccess.create({
      data: {
        orgId: ctx.org.id, residentId: r.id, contactId: contact.id, role: p.role, grants: scope, consentScope: scope,
        inviteEmail: p.email, inviteName: p.name, invitedById: ctx.user.id,
        consentBy: p.consentBy, consentName: p.consentName, consentAt, consentNote: p.consentNote || null, consentById: ctx.user.id,
      },
    })
    const link = await sendPortalInvite(ctx, a.id)
    await audit(ctx, { action: 'portal.access.invite', entityType: 'PortalAccess', entityId: a.id, after: accessSnap(a), context: { residentId: r.id, contactId: contact.id, mailed: link.mailed } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { portal: true } })
    refresh()
    return { ok: true, data: { url: link.url, expiresAt: link.expiresAt.toISOString(), mailed: link.mailed } }
  })
}

/** Neuer Einladungslink (ersetzt den alten), z. B. nach Ablauf. */
export async function reissuePortalInviteAction(residentId: string, accessId: string): Promise<ActionResult<InviteResult>> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'portal.manage')
    if (!portalEnabled(ctx.org)) return { ok: false, error: 'portal.errors.module' }
    const a = await db.portalAccess.findFirst({ where: { id: accessId, residentId: r.id, orgId: ctx.org.id } })
    if (!a || a.revokedAt || a.acceptedAt) return { ok: false, error: 'common.notFound' }
    const link = await sendPortalInvite(ctx, a.id)
    await audit(ctx, { action: 'portal.access.reinvite', entityType: 'PortalAccess', entityId: a.id, context: { residentId: r.id, mailed: link.mailed } })
    refresh()
    return { ok: true, data: { url: link.url, expiresAt: link.expiresAt.toISOString(), mailed: link.mailed } }
  })
}

/** Widerruf (Einwilligung zurückgezogen oder Zugang nicht mehr gewünscht) – wirkt sofort. */
export async function revokePortalAccessAction(residentId: string, accessId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'portal.manage')
    const a = await db.portalAccess.findFirst({ where: { id: accessId, residentId: r.id, orgId: ctx.org.id } })
    if (!a) return { ok: false, error: 'common.notFound' }
    const reason = fd(form, 'reason').slice(0, 300) || null
    await revokeAccess(ctx, a.id, reason)
    refresh()
    return { ok: true, message: 'portal.access.revoked' }
  })
}
