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

export async function createSession(userId: string, mfaPassed: boolean) {
  const token = randomBytes(32).toString('base64url')
  const meta = await requestMeta()
  const expiresAt = new Date(Date.now() + env.sessionHours * 3600_000)
  const session = await db.session.create({
    data: { userId, tokenHash: sha256(token), mfaPassed, ip: meta.ip, userAgent: meta.userAgent, expiresAt },
  })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: '/', expires: expiresAt })
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
  return session
}

/** Liefert die aktuelle Sitzung (pro Request gecacht). Verlängert gleitend, höchstens einmal pro Minute. */
export const getSession = cache(async () => {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } })
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.active) return null
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + env.sessionHours * 3600_000) },
    })
  }
  return session
})

export async function sessionFromToken(token: string | undefined | null) {
  if (!token) return null
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } })
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.user.active || !s.mfaPassed) return null
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
  const s = await getSession()
  if (!s) redirect('/login')
  if (!s.mfaPassed) redirect('/login/mfa')
  return s
}

export const hashToken = sha256
