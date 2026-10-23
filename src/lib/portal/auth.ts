import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { orgBlockReason, orgLoginBlock, requestMeta } from '@/lib/auth/session'
import { PORTAL_COOKIE, PORTAL_COOKIE_PATH } from './routing'

/**
 * Sitzungen des Angehörigenportals – vollständig getrennt von src/lib/auth/session.ts:
 * eigene Tabelle (PortalSession), eigenes Cookie (Pfad /portal), eigener Hash-Präfix.
 * Diese Datei liest nie das Cookie der Mitarbeitenden.
 */
export const PORTAL_SESSION_HOURS = Number(process.env.PORTAL_SESSION_HOURS) || 72

/** Hash mit eigenem Präfix: ein Token der Stationsapp kann nie eine Portal-Sitzung treffen (und umgekehrt). */
export const portalHash = (s: string) => createHash('sha256').update('portal:' + s).digest('hex')

export class PortalOrgBlockedError extends Error {
  constructor(public reason: 'pending' | 'suspended') {
    super('portal_org_' + reason)
  }
}

export async function createPortalSession(accountId: string, mfaPassed: boolean) {
  // Gesperrte Organisation (Plattform-Administration): keine neuen Portal-Sitzungen
  const acc = await db.portalAccount.findUnique({ where: { id: accountId }, select: { orgId: true } })
  const block = acc ? await orgLoginBlock(acc.orgId) : 'suspended'
  if (block) throw new PortalOrgBlockedError(block)
  const token = randomBytes(32).toString('base64url')
  const meta = await requestMeta()
  const expiresAt = new Date(Date.now() + PORTAL_SESSION_HOURS * 3600_000)
  const session = await db.portalSession.create({
    data: { accountId, tokenHash: portalHash(token), mfaPassed, ip: meta.ip, userAgent: meta.userAgent, expiresAt },
  })
  const jar = await cookies()
  jar.set(PORTAL_COOKIE, token, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: PORTAL_COOKIE_PATH, expires: expiresAt })
  await db.portalAccount.update({ where: { id: accountId }, data: { lastLoginAt: new Date() } })
  return session
}

/** Aktuelle Portal-Sitzung (pro Request gecacht), gleitend verlängert. Gesperrte Konten haben keine Sitzung. */
export const getPortalSession = cache(async () => {
  const jar = await cookies()
  const token = jar.get(PORTAL_COOKIE)?.value
  if (!token) return null
  const s = await db.portalSession.findUnique({ where: { tokenHash: portalHash(token) }, include: { account: { include: { org: { select: { suspendedAt: true, suspendedReason: true } } } } } })
  // Gesperrte Konten und gesperrte Organisationen haben keine gültige Sitzung
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.account.lockedAt || orgBlockReason(s.account.org)) return null
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    await db.portalSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + PORTAL_SESSION_HOURS * 3600_000) } })
  }
  return s
})

export async function destroyPortalSession() {
  const jar = await cookies()
  const token = jar.get(PORTAL_COOKIE)?.value
  if (token) await db.portalSession.updateMany({ where: { tokenHash: portalHash(token) }, data: { revokedAt: new Date() } })
  jar.set(PORTAL_COOKIE, '', { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: PORTAL_COOKIE_PATH, expires: new Date(0) })
}

/** Für Portal-Seiten: ohne Sitzung zur Portal-Anmeldung, mit offenem zweitem Faktor zur Code-Eingabe. */
export async function requirePortalSession() {
  const s = await getPortalSession()
  if (!s) redirect('/portal/login')
  if (!s.mfaPassed) redirect('/portal/login/mfa')
  return s
}

/** Alle Sitzungen eines Kontos beenden (Sperren, Passwort geändert, alle Zugänge widerrufen). */
export async function revokePortalSessions(accountId: string, exceptId?: string) {
  await db.portalSession.updateMany({ where: { accountId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { revokedAt: new Date() } })
}
