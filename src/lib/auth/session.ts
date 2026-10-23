import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

export const SESSION_COOKIE = 'careos_session'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export async function requestMeta() {
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null
  return { ip, userAgent: h.get('user-agent')?.slice(0, 400) ?? null }
}

/** method: Anmeldeverfahren (password | passkey | sso), massgeblich für die MFA-Pflicht (SSO ist ausgenommen). */
export async function createSession(userId: string, mfaPassed: boolean, method: 'password' | 'passkey' | 'sso' = 'password') {
  // Gesperrte Organisation (PRD §42): Anmeldeverfahren prüfen vorher mit orgLoginBlock() und zeigen eine Meldung.
  const u = await db.user.findUnique({ where: { id: userId }, select: { orgId: true } })
  const block = u ? await orgLoginBlock(u.orgId) : 'suspended'
  if (block) throw new OrgSuspendedError(block)
  const token = randomBytes(32).toString('base64url')
  const meta = await requestMeta()
  const expiresAt = new Date(Date.now() + env.sessionHours * 3600_000)
  const session = await db.session.create({
    data: { userId, tokenHash: sha256(token), mfaPassed, method, ip: meta.ip, userAgent: meta.userAgent, expiresAt },
  })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: '/', expires: expiresAt })
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
  return session
}

/** Sitzung inkl. Sperrstatus der Organisation (PRD §42). */
const loadSession = cache(async () => {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { org: { select: { suspendedAt: true, suspendedReason: true } } } } } })
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.active) return null
  if (session.user.org.suspendedAt) return { session, blocked: orgBlockReason(session.user.org) }
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + env.sessionHours * 3600_000) },
    })
  }
  return { session, blocked: null }
})

/** Liefert die aktuelle Sitzung (pro Request gecacht). Verlängert gleitend, höchstens einmal pro Minute. Gesperrte Organisation → null. */
export const getSession = cache(async () => {
  const r = await loadSession()
  return r && !r.blocked ? r.session : null
})

/** Sperrgrund einer Organisation: «pending» (Registrierung wartet auf Freigabe) oder «suspended». */
export function orgBlockReason(org: { suspendedAt: Date | null; suspendedReason: string | null }): 'pending' | 'suspended' | null {
  if (!org.suspendedAt) return null
  return org.suspendedReason === 'pending' ? 'pending' : 'suspended'
}

/** Für Anmeldeverfahren: darf sich jemand dieser Organisation anmelden? */
export async function orgLoginBlock(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { suspendedAt: true, suspendedReason: true } })
  return org ? orgBlockReason(org) : 'suspended'
}

export class OrgSuspendedError extends Error {
  constructor(public reason: 'pending' | 'suspended') {
    super('org_' + reason)
  }
}

export async function sessionFromToken(token: string | undefined | null) {
  if (!token) return null
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { org: { select: { suspendedAt: true, suspendedReason: true } } } } } })
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.user.active || !s.mfaPassed || s.user.org.suspendedAt) return null
  return s
}

export async function destroySession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await db.session.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } })
  jar.delete(SESSION_COOKIE)
}

/** Für geschützte Seiten: ohne gültige Sitzung zum Login, mit offener MFA zur Code-Eingabe. */
export async function requireSession() {
  const r = await loadSession()
  if (r?.blocked) redirect('/login?error=' + (r.blocked === 'pending' ? 'orgPending' : 'suspended'))
  const s = r?.session
  if (!s) redirect('/login')
  if (!s.mfaPassed) redirect('/login/mfa')
  return s
}

export const hashToken = sha256
