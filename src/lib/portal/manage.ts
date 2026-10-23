import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { dictionary } from '@/i18n'
import { makeT, type Locale, type Terminology } from '@/i18n/core'
import { fmtDate } from '@/lib/time'
import { mailConfigured, sendMail } from '@/lib/mail'
import { revokePortalSessions } from './auth'
import { issuePortalInvite } from './invites'
import { isSelfAccess } from './policy'

/** Schnappschuss eines Zugangs fürs Audit (ohne Token-Hash). */
export const accessSnap = (a: { role: string; grants: string[]; consentBy: string; consentName: string; consentAt: Date; consentScope: string[]; consentNote: string | null; inviteEmail: string; revokedAt: Date | null; revokeReason: string | null }) => ({
  role: a.role, grants: a.grants, consentBy: a.consentBy, consentName: a.consentName, consentAt: a.consentAt, consentScope: a.consentScope,
  consentNote: a.consentNote, inviteEmail: a.inviteEmail, revokedAt: a.revokedAt, revokeReason: a.revokeReason,
})

/** Link erzeugen und, falls ein Mail-Adapter konfiguriert ist, versenden. Ohne Gesundheitsdaten im Text. */
export async function sendPortalInvite(ctx: Ctx, accessId: string) {
  const a = await db.portalAccess.findUniqueOrThrow({ where: { id: accessId } })
  const link = await issuePortalInvite(a.id)
  let mailed = false
  if (mailConfigured()) {
    const locale = ctx.org.defaultLocale as Locale
    const t = makeT(dictionary(locale), locale, ctx.org.terminology as Terminology)
    const org = ctx.org.brandName || ctx.org.name
    // Bewohnerportal: eigener Betreff und Text (die Person selbst, nicht Angehörige)
    const ns = isSelfAccess(a) ? 'residentPortal.mail.' : 'portal.mail.'
    mailed = (await sendMail({
      to: a.inviteEmail,
      subject: t(ns + 'subject', { org }),
      text: t(ns + 'text', { name: a.inviteName, org, url: link.url, until: fmtDate(link.expiresAt, locale) }),
    })).sent
  }
  return { ...link, mailed }
}

/** Widerruf eines Zugangs (wirkt sofort). Ohne weitere aktive Zugänge werden die Sitzungen des Kontos beendet. */
export async function revokeAccess(ctx: Ctx, accessId: string, reason: string | null) {
  const old = await db.portalAccess.findFirst({ where: { id: accessId, orgId: ctx.org.id }, include: { resident: { select: { unitId: true } } } })
  if (!old || old.revokedAt) return null
  const a = await db.portalAccess.update({
    where: { id: old.id },
    data: { revokedAt: new Date(), revokedById: ctx.user.id, revokeReason: reason, inviteTokenHash: null, inviteExpiresAt: null },
  })
  if (a.accountId) {
    const left = await db.portalAccess.count({ where: { accountId: a.accountId, revokedAt: null } })
    if (!left) await revokePortalSessions(a.accountId)
  }
  await audit(ctx, { action: 'portal.access.revoke', entityType: 'PortalAccess', entityId: a.id, before: accessSnap(old), after: accessSnap(a), context: { residentId: a.residentId, reason } })
  await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: old.resident.unitId, residentId: a.residentId, actorId: ctx.user.id, payload: { portal: true } })
  return a
}

/** Kontakt gelöscht → zugehörige Zugänge widerrufen (Einwilligung bezog sich auf diese Person). */
export async function revokeForContact(ctx: Ctx, contactId: string) {
  const rows = await db.portalAccess.findMany({ where: { orgId: ctx.org.id, contactId, revokedAt: null }, select: { id: true } })
  for (const r of rows) await revokeAccess(ctx, r.id, 'contact_deleted')
  return rows.length
}
