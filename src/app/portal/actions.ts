'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { requestMeta } from '@/lib/auth/session'
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password'
import { verifyTotp } from '@/lib/auth/mfa'
import { peekRateLimit, rateLimit } from '@/lib/rate-limit'
import { auditSystem } from '@/lib/audit'
import { createPortalSession, destroyPortalSession, getPortalSession } from '@/lib/portal/auth'
import { findPortalInvite } from '@/lib/portal/invites'
import { normalizeEmail } from '@/lib/portal/invite-core'
import { residentVisible } from '@/lib/portal/policy'
import { portalEnabled } from '@/lib/portal/module'
import { PORTAL_RESIDENT_COOKIE, safePortalNext } from '@/lib/portal/routing'
import { pickLocale, type Locale } from '@/i18n/core'

/**
 * Anmeldung, Zweitfaktor und Einladung im Angehörigenportal. Nutzt nie die Sitzung der Mitarbeitenden:
 * Konten aus PortalAccount, Sitzungen aus PortalSession (src/lib/portal/auth.ts).
 */
export type PortalAuthState = { error?: string; retry?: number; email?: string } | undefined

const prod = process.env.NODE_ENV === 'production'

export async function portalLoginAction(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const email = normalizeEmail(String(form.get('email') ?? ''))
  const password = String(form.get('password') ?? '')
  const meta = await requestMeta()
  // Wie die Stationsapp: Fehlversuche je Konto+IP und je IP zählen, Erfolge nicht (PRD §37)
  const accKey = `portal-login:${meta.ip}:${email}`
  const accLimit = prod ? 8 : 200
  const rl = await peekRateLimit(accKey, accLimit - 1)
  if (!rl.ok) return { error: 'locked', retry: rl.retryAfter, email }
  const ipKey = `portal-login-ip-fail:${meta.ip ?? 'unknown'}`
  const ipLimit = prod ? 50 : 2000
  const ipRl = await peekRateLimit(ipKey, ipLimit - 1)
  if (!ipRl.ok) return { error: 'locked', retry: ipRl.retryAfter, email }

  // Eine Adresse kann in mehreren Organisationen ein Konto haben; das Passwort entscheidet.
  const accounts = email ? await db.portalAccount.findMany({ where: { email }, orderBy: { lastLoginAt: 'desc' }, take: 5 }) : []
  let account: (typeof accounts)[number] | null = null
  for (const a of accounts) if (await verifyPassword(a.passwordHash, password)) { account = a; break }
  if (!accounts.length) await verifyPassword(null, password)
  if (!account) {
    await auditSystem({ action: 'portal.login_failed', entityType: 'PortalAccount', entityId: accounts[0]?.id, orgId: accounts[0]?.orgId, context: { email }, ...meta })
    await rateLimit(ipKey, ipLimit, 10 * 60_000)
    await rateLimit(accKey, accLimit, 10 * 60_000)
    return { error: 'invalid', email }
  }
  const org = await db.organization.findUnique({ where: { id: account.orgId } })
  if (account.lockedAt || !portalEnabled(org)) {
    await auditSystem({ action: 'portal.login_blocked', entityType: 'PortalAccount', entityId: account.id, orgId: account.orgId, context: { reason: account.lockedAt ? 'locked' : 'module' }, ...meta })
    return { error: account.lockedAt ? 'accountLocked' : 'unavailable', email }
  }
  await createPortalSession(account.id, !account.mfaEnabled)
  await auditSystem({ action: 'portal.login', entityType: 'PortalAccount', entityId: account.id, orgId: account.orgId, context: { portalAccountId: account.id, method: 'password' }, ...meta })
  const next = safePortalNext(form.get('next'))
  if (account.mfaEnabled) redirect('/portal/login/mfa?next=' + encodeURIComponent(next))
  redirect(next)
}

export async function portalMfaAction(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const s = await getPortalSession()
  if (!s) redirect('/portal/login')
  const meta = await requestMeta()
  const rl = await rateLimit(`portal-mfa:${s.id}`, 6, 5 * 60_000)
  if (!rl.ok) return { error: 'locked', retry: rl.retryAfter }
  if (!s.account.mfaSecret || !verifyTotp(s.account.mfaSecret, String(form.get('code') ?? ''), s.account.email)) {
    await auditSystem({ action: 'portal.mfa_failed', entityType: 'PortalAccount', entityId: s.accountId, orgId: s.account.orgId, context: { portalAccountId: s.accountId }, ...meta })
    return { error: 'mfaInvalid' }
  }
  await db.portalSession.update({ where: { id: s.id }, data: { mfaPassed: true } })
  await auditSystem({ action: 'portal.mfa_passed', entityType: 'PortalAccount', entityId: s.accountId, orgId: s.account.orgId, context: { portalAccountId: s.accountId }, ...meta })
  redirect(safePortalNext(form.get('next')))
}

export async function portalLogoutAction() {
  const s = await getPortalSession()
  if (s) await auditSystem({ action: 'portal.logout', entityType: 'PortalAccount', entityId: s.accountId, orgId: s.account.orgId, context: { portalAccountId: s.accountId }, ...(await requestMeta()) })
  await destroyPortalSession()
  ;(await cookies()).delete(PORTAL_RESIDENT_COOKIE)
  redirect('/portal/login')
}

/**
 * Einladung annehmen. Neues Konto (Name, Passwort, Hinweise gelesen) oder bestehendes Konto derselben Adresse
 * in derselben Organisation (Passwort bestätigen). Der Link gilt einmal; danach wird der Hash gelöscht.
 */
export async function acceptPortalInviteAction(_: PortalAuthState, form: FormData): Promise<PortalAuthState> {
  const meta = await requestMeta()
  if (!(await rateLimit('portal-invite:' + meta.ip, prod ? 10 : 500, 10 * 60_000)).ok) return { error: 'rate' }
  const { access, problem } = await findPortalInvite(String(form.get('token') ?? ''))
  if (!access || problem) return { error: problem ?? 'invalid' }
  if (!residentVisible(access.resident) || access.resident.orgId !== access.orgId) return { error: 'invalid' }
  const org = await db.organization.findUnique({ where: { id: access.orgId } })
  if (!portalEnabled(org)) return { error: 'unavailable' }

  const pw = String(form.get('password') ?? '')
  const existing = await db.portalAccount.findUnique({ where: { orgId_email: { orgId: access.orgId, email: access.inviteEmail } } })
  let accountId: string
  if (existing) {
    if (existing.lockedAt) return { error: 'accountLocked' }
    if (!(await verifyPassword(existing.passwordHash, pw))) {
      await auditSystem({ action: 'portal.login_failed', entityType: 'PortalAccount', entityId: existing.id, orgId: existing.orgId, context: { via: 'invite' }, ...meta })
      await rateLimit(`portal-login:${meta.ip}:${existing.email}`, prod ? 8 : 200, 10 * 60_000)
      return { error: 'invalid' }
    }
    accountId = existing.id
  } else {
    const name = String(form.get('name') ?? '').trim().slice(0, 120)
    if (name.length < 2) return { error: 'name' }
    const problemPw = passwordProblem(pw)
    if (problemPw) return { error: problemPw }
    if (pw !== String(form.get('repeat') ?? '')) return { error: 'mismatch' }
    if (form.get('privacy') !== 'on') return { error: 'privacy' }
    const jar = await cookies()
    const locale: Locale = pickLocale(String(form.get('locale') ?? '') || jar.get('careos_locale')?.value || org?.defaultLocale || 'de')
    const created = await db.portalAccount.create({
      data: { orgId: access.orgId, email: access.inviteEmail, name, passwordHash: await hashPassword(pw), locale },
    })
    accountId = created.id
  }
  // Atomar: nur annehmen, wenn der Link noch gilt (gleichzeitiges Absenden, zweites Gerät)
  const done = await db.portalAccess.updateMany({
    where: { id: access.id, inviteTokenHash: access.inviteTokenHash, acceptedAt: null, revokedAt: null, inviteExpiresAt: { gt: new Date() } },
    data: { accountId, acceptedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
  })
  if (!done.count) return { error: 'used' }
  await auditSystem({ action: 'portal.access.accepted', entityType: 'PortalAccess', entityId: access.id, orgId: access.orgId, context: { portalAccountId: accountId, residentId: access.residentId, newAccount: !existing }, ...meta })
  const acc = await db.portalAccount.findUniqueOrThrow({ where: { id: accountId } })
  await createPortalSession(accountId, !acc.mfaEnabled)
  ;(await cookies()).set(PORTAL_RESIDENT_COOKIE, access.id, { httpOnly: true, sameSite: 'lax', path: '/portal', secure: prod, maxAge: 365 * 86400 })
  redirect(acc.mfaEnabled ? '/portal/login/mfa' : '/portal')
}
