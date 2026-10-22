import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { randomToken } from '@/lib/crypto'
import { hashToken } from '@/lib/auth/session'

export const INVITE_DAYS = 7

/** Einmal-Link zum Setzen eines Passworts (Einladung oder Zurücksetzen). Nur der Hash wird gespeichert; ein neuer Link ersetzt den alten. */
export async function issueLink(userId: string, kind: 'invite' | 'reset') {
  const token = randomToken(32)
  await db.$transaction([
    db.authChallenge.deleteMany({ where: { userId, kind: { in: ['invite', 'reset'] } } }),
    db.authChallenge.create({ data: { userId, kind, challenge: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) } }),
  ])
  return new URL('/login/invite?token=' + token, env.appUrl).toString()
}

/**
 * Konten ohne Zugang (eingeladen, noch nie angemeldet): aktiv, keine Anfrage, kein Passwort, kein Passkey, kein SSO.
 * Dazu gehören die beim Erststart erzeugten Mitarbeitenden (INIT_STAFF) und Einladungen aus Admin → Benutzer.
 */
export const awaitingAccessWhere = (orgId: string): Prisma.UserWhereInput => ({
  orgId, active: true, pendingSince: null, passwordHash: null, ssoSubject: null, lastLoginAt: null, passkeys: { none: {} },
})
