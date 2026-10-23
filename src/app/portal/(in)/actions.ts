'use server'

import { cookies } from 'next/headers'
import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { fd, type ActionResult } from '@/lib/action'
import { atTime, parseDateKey } from '@/lib/time'
import { rateLimit } from '@/lib/rate-limit'
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password'
import { newMfaSecret, verifyTotp } from '@/lib/auth/mfa'
import { decrypt, encrypt } from '@/lib/crypto'
import { TEXT_COOKIE, THEME_COOKIE, normalizeTextSize, normalizeTheme } from '@/lib/theme'
import { LOCALES } from '@/i18n/core'
import { getPortalCtx, portalAudit, requireGrant } from '@/lib/portal/context'
import { portalRun } from '@/lib/portal/action'
import { revokePortalSessions } from '@/lib/portal/auth'
import { notifyFamilyInbox } from '@/lib/portal/notify'
import { MESSAGE_MAX, SUBJECT_MAX, VISITOR_NAME_MAX, isSelfAccess, portalSettings, threadStatusAfter, visitProblem, visitTransition } from '@/lib/portal/policy'
import { PORTAL_RESIDENT_COOKIE } from '@/lib/portal/routing'

const prod = process.env.NODE_ENV === 'production'

/** Person wählen (nur unter den eigenen Zugängen). */
export async function selectResidentAction(accessId: string): Promise<ActionResult> {
  return portalRun(async () => {
    const p = await getPortalCtx()
    if (!p.accesses.some((a) => a.id === accessId)) return { ok: false, error: 'portal.errors.forbidden' }
    ;(await cookies()).set(PORTAL_RESIDENT_COOKIE, accessId, { httpOnly: true, sameSite: 'lax', path: '/portal', secure: prod, maxAge: 365 * 86400 })
    refresh()
  })
}

const msgSchema = z.object({
  subject: z.string().min(2, 'portal.errors.subject').max(SUBJECT_MAX),
  body: z.string().min(2, 'portal.errors.body').max(MESSAGE_MAX, 'portal.errors.bodyLong'),
})

/** Neue Nachricht an das Team. */
export async function newMessageAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return portalRun(async () => {
    const { p, access } = await requireGrant('messages')
    if (!(await rateLimit('portal-msg:' + p.account.id, prod ? 20 : 500, 60 * 60_000)).ok) return { ok: false, error: 'portal.errors.rate' }
    const v = msgSchema.parse({ subject: fd(form, 'subject'), body: fd(form, 'body') })
    const th = await db.portalThread.create({
      data: { orgId: p.org.id, residentId: access.residentId, accessId: access.id, subject: v.subject, status: 'open', familyReadAt: new Date(), messages: { create: { side: 'family', accountId: p.account.id, body: v.body } } },
    })
    await portalAudit(p, { action: 'portal.message.create', entityType: 'PortalThread', entityId: th.id, context: { residentId: access.residentId, length: v.body.length } })
    await notifyFamilyInbox({ orgId: p.org.id, residentId: access.residentId, kind: 'message', itemId: th.id, self: isSelfAccess(access) })
    refresh()
    return { ok: true, data: { id: th.id }, message: 'portal.messages.sent' }
  })
}

/** Antwort in einem bestehenden Gespräch; öffnet es für das Team wieder. */
export async function replyMessageAction(threadId: string, form: FormData): Promise<ActionResult> {
  return portalRun(async () => {
    const { p, access } = await requireGrant('messages')
    if (!(await rateLimit('portal-msg:' + p.account.id, prod ? 20 : 500, 60 * 60_000)).ok) return { ok: false, error: 'portal.errors.rate' }
    const body = msgSchema.shape.body.parse(fd(form, 'body'))
    const th = await db.portalThread.findFirst({ where: { id: threadId, orgId: p.org.id, residentId: access.residentId, access: { accountId: p.account.id } } })
    if (!th) return { ok: false, error: 'common.notFound' }
    const now = new Date()
    await db.$transaction([
      db.portalMessage.create({ data: { threadId: th.id, side: 'family', accountId: p.account.id, body } }),
      db.portalThread.update({ where: { id: th.id }, data: { status: threadStatusAfter('family'), lastMessageAt: now, familyReadAt: now } }),
    ])
    await portalAudit(p, { action: 'portal.message.reply', entityType: 'PortalThread', entityId: th.id, context: { residentId: access.residentId, length: body.length } })
    await notifyFamilyInbox({ orgId: p.org.id, residentId: access.residentId, kind: 'message', itemId: th.id, assigneeId: th.assigneeId, self: isSelfAccess(access) })
    refresh()
    return { ok: true, message: 'portal.messages.sent' }
  })
}

/** Besuch anmelden. Bestätigt wird er vom Team (Team → Angehörige). Die Person selbst gibt an, wer kommt. */
export async function requestVisitAction(form: FormData): Promise<ActionResult> {
  return portalRun(async () => {
    const { p, access } = await requireGrant('visits')
    const self = isSelfAccess(access)
    const visitorName = self ? fd(form, 'visitorName').slice(0, VISITOR_NAME_MAX) : ''
    if (self && visitorName.length < 2) return { ok: false, error: 'residentPortal.errors.visitorName', field: 'visitorName' }
    if (!(await rateLimit('portal-visit:' + p.account.id, prod ? 20 : 500, 24 * 60 * 60_000)).ok) return { ok: false, error: 'portal.errors.rate' }
    const date = fd(form, 'date')
    const from = fd(form, 'from')
    const to = fd(form, 'to')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'portal.errors.visitTime', field: 'date' }
    if (!/^\d{2}:\d{2}$/.test(from)) return { ok: false, error: 'portal.errors.visitTime', field: 'from' }
    if (!/^\d{2}:\d{2}$/.test(to)) return { ok: false, error: 'portal.errors.visitEnd', field: 'to' }
    const day = parseDateKey(date)
    const start = atTime(day, from)
    const end = atTime(day, to)
    const visitors = Number(fd(form, 'visitors') || '1')
    const problem = visitProblem({ start, end, visitors }, portalSettings(p.org.settings))
    if (problem) return { ok: false, error: 'portal.errors.' + problem, field: problem === 'visitors' ? 'visitors' : problem === 'visitEnd' || problem === 'visitLong' ? 'to' : 'date' }
    const note = fd(form, 'note').slice(0, 500) || null
    const v = await db.visitRequest.create({ data: { orgId: p.org.id, residentId: access.residentId, accessId: access.id, start, end, visitors, note, visitorName: visitorName || null } })
    await portalAudit(p, { action: 'portal.visit.request', entityType: 'VisitRequest', entityId: v.id, after: { start, end, visitors, ...(self ? { visitorName } : {}) }, context: { residentId: access.residentId, role: access.role } })
    await notifyFamilyInbox({ orgId: p.org.id, residentId: access.residentId, kind: 'visit', itemId: v.id, self })
    refresh()
    return { ok: true, message: 'portal.visits.requested' }
  })
}

/** Besuch zurückziehen (offen oder bestätigt). Ein bestätigter Termin wird in der Akte als erledigt markiert entfernt. */
export async function cancelVisitAction(id: string): Promise<ActionResult> {
  return portalRun(async () => {
    const { p, access } = await requireGrant('visits')
    const v = await db.visitRequest.findFirst({ where: { id, orgId: p.org.id, residentId: access.residentId, access: { accountId: p.account.id } } })
    if (!v) return { ok: false, error: 'common.notFound' }
    if (!visitTransition(v.status, 'cancelled', 'family')) return { ok: false, error: 'portal.errors.visitState' }
    const done = await db.visitRequest.updateMany({ where: { id: v.id, status: v.status }, data: { status: 'cancelled' } })
    if (!done.count) return { ok: false, error: 'portal.errors.visitState' }
    if (v.appointmentId) await db.appointment.deleteMany({ where: { id: v.appointmentId, residentId: v.residentId, kind: 'relatives' } })
    await portalAudit(p, { action: 'portal.visit.cancel', entityType: 'VisitRequest', entityId: v.id, before: { status: v.status }, after: { status: 'cancelled' }, context: { residentId: v.residentId } })
    if (v.status === 'confirmed') await notifyFamilyInbox({ orgId: p.org.id, residentId: v.residentId, kind: 'visit', itemId: v.id, assigneeId: v.decidedById, self: isSelfAccess(access) })
    refresh()
    return { ok: true, message: 'portal.visits.cancelled' }
  })
}

// ───────── Konto ─────────

export async function updateProfileAction(form: FormData): Promise<ActionResult> {
  return portalRun(async () => {
    const p = await getPortalCtx()
    const name = z.string().min(2, 'portal.errors.name').max(120).parse(fd(form, 'name'))
    const phone = fd(form, 'phone').slice(0, 40) || null
    const loc = fd(form, 'locale')
    const locale = (LOCALES as readonly string[]).includes(loc) ? (loc as (typeof LOCALES)[number]) : p.account.locale
    // Schriftgrösse gehört zum Konto (gilt auf jedem Gerät nach der Anmeldung), Farbschema bleibt pro Gerät
    const textSize = normalizeTextSize(fd(form, 'text'))
    await db.portalAccount.update({ where: { id: p.account.id }, data: { name, phone, locale, textSize } })
    const theme = normalizeTheme(fd(form, 'theme'))
    ;(await cookies()).set(THEME_COOKIE, theme, { sameSite: 'lax', path: '/', secure: prod, maxAge: 365 * 86400 })
    ;(await cookies()).set(TEXT_COOKIE, textSize, { sameSite: 'lax', path: '/', secure: prod, maxAge: 365 * 86400 })
    await portalAudit(p, { action: 'portal.account.update', entityType: 'PortalAccount', entityId: p.account.id, before: { name: p.account.name, phone: p.account.phone, locale: p.account.locale, textSize: p.account.textSize }, after: { name, phone, locale, textSize } })
    refresh()
    return { ok: true, message: 'common.saved' }
  })
}

/** Schriftgrösse direkt umschalten (Bewohnerportal, Kopfzeile). Gespeichert am Konto und auf dem Gerät. */
export async function setTextSizeAction(size: string): Promise<ActionResult> {
  return portalRun(async () => {
    const p = await getPortalCtx()
    const textSize = normalizeTextSize(size)
    if (textSize !== p.account.textSize) {
      await db.portalAccount.update({ where: { id: p.account.id }, data: { textSize } })
      await portalAudit(p, { action: 'portal.account.update', entityType: 'PortalAccount', entityId: p.account.id, before: { textSize: p.account.textSize }, after: { textSize } })
    }
    ;(await cookies()).set(TEXT_COOKIE, textSize, { sameSite: 'lax', path: '/', secure: prod, maxAge: 365 * 86400 })
    refresh()
  })
}

export async function changePasswordAction(form: FormData): Promise<ActionResult> {
  return portalRun(async () => {
    const p = await getPortalCtx()
    if (!(await rateLimit('portal-pw:' + p.account.id, 8, 10 * 60_000)).ok) return { ok: false, error: 'portal.errors.rate' }
    if (!(await verifyPassword(p.account.passwordHash, String(form.get('current') ?? '')))) return { ok: false, error: 'portal.errors.currentPassword', field: 'current' }
    const pw = String(form.get('password') ?? '')
    const problem = passwordProblem(pw)
    if (problem) return { ok: false, error: 'portal.acceptErrors.' + problem, field: 'password' }
    if (pw !== String(form.get('repeat') ?? '')) return { ok: false, error: 'portal.acceptErrors.mismatch', field: 'repeat' }
    await db.portalAccount.update({ where: { id: p.account.id }, data: { passwordHash: await hashPassword(pw) } })
    await revokePortalSessions(p.account.id, p.sessionId)
    await portalAudit(p, { action: 'portal.account.password', entityType: 'PortalAccount', entityId: p.account.id })
    return { ok: true, message: 'portal.account.passwordChanged' }
  })
}

const MFA_KIND = 'portal_mfa_setup'

/** Zweiten Faktor einrichten (optional): Geheimnis 10 Min. gültig, Bestätigung mit Code. */
export async function startPortalMfaAction(): Promise<ActionResult<{ qr: string; secret: string }>> {
  return portalRun(async () => {
    const p = await getPortalCtx()
    if (p.account.mfaEnabled) return { ok: false, error: 'portal.errors.mfaOn' }
    const s = await newMfaSecret(p.account.email)
    await db.authChallenge.deleteMany({ where: { userId: p.account.id, kind: MFA_KIND } })
    await db.authChallenge.create({ data: { userId: p.account.id, kind: MFA_KIND, challenge: s.encrypted, expiresAt: new Date(Date.now() + 10 * 60_000) } })
    return { ok: true, data: { qr: s.qr, secret: s.base32.replace(/(.{4})/g, '$1 ').trim() } }
  })
}

export async function confirmPortalMfaAction(form: FormData): Promise<ActionResult> {
  return portalRun(async () => {
    const p = await getPortalCtx()
    if (!(await rateLimit('portal-mfa-setup:' + p.account.id, 8, 10 * 60_000)).ok) return { ok: false, error: 'portal.errors.rate' }
    const ch = await db.authChallenge.findFirst({ where: { userId: p.account.id, kind: MFA_KIND, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
    if (!ch) return { ok: false, error: 'portal.errors.mfaExpired' }
    if (!verifyTotp(ch.challenge, fd(form, 'code'), p.account.email)) return { ok: false, error: 'portal.mfa.invalid', field: 'code' }
    await db.$transaction([
      db.portalAccount.update({ where: { id: p.account.id }, data: { mfaSecret: encrypt(decrypt(ch.challenge)), mfaEnabled: true } }),
      db.authChallenge.deleteMany({ where: { userId: p.account.id, kind: MFA_KIND } }),
      db.portalSession.update({ where: { id: p.sessionId }, data: { mfaPassed: true } }),
    ])
    await portalAudit(p, { action: 'portal.account.mfa_enabled', entityType: 'PortalAccount', entityId: p.account.id })
    refresh()
    return { ok: true, message: 'portal.account.mfaEnabled' }
  })
}

export async function disablePortalMfaAction(form: FormData): Promise<ActionResult> {
  return portalRun(async () => {
    const p = await getPortalCtx()
    if (!(await rateLimit('portal-mfa-setup:' + p.account.id, 8, 10 * 60_000)).ok) return { ok: false, error: 'portal.errors.rate' }
    if (!p.account.mfaEnabled || !p.account.mfaSecret) return { ok: true }
    if (!verifyTotp(p.account.mfaSecret, fd(form, 'code'), p.account.email)) {
      await portalAudit(p, { action: 'portal.mfa_failed', entityType: 'PortalAccount', entityId: p.account.id })
      return { ok: false, error: 'portal.mfa.invalid', field: 'code' }
    }
    await db.portalAccount.update({ where: { id: p.account.id }, data: { mfaSecret: null, mfaEnabled: false } })
    await portalAudit(p, { action: 'portal.account.mfa_disabled', entityType: 'PortalAccount', entityId: p.account.id })
    refresh()
    return { ok: true, message: 'portal.account.mfaDisabled' }
  })
}

/** Auf allen anderen Geräten abmelden. */
export async function signOutOthersAction(): Promise<ActionResult> {
  return portalRun(async () => {
    const p = await getPortalCtx()
    await revokePortalSessions(p.account.id, p.sessionId)
    await portalAudit(p, { action: 'portal.account.sessions_revoked', entityType: 'PortalAccount', entityId: p.account.id })
    return { ok: true, message: 'portal.account.signedOutOthers' }
  })
}
