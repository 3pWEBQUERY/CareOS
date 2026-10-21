import 'server-only'
import { db } from '@/lib/db'
import { hashToken } from '@/lib/auth/session'

/** Prüft einen Einladungs- oder Rücksetz-Link (nur der SHA-256-Hash ist gespeichert). */
export async function findLink(token: string) {
  if (!token || token.length < 20) return null
  const ch = await db.authChallenge.findFirst({ where: { challenge: hashToken(token), kind: { in: ['invite', 'reset'] }, expiresAt: { gt: new Date() } } })
  if (!ch?.userId) return null
  const user = await db.user.findUnique({ where: { id: ch.userId }, select: { id: true, orgId: true, email: true, active: true } })
  if (!user || !user.active) return null
  return { ch: { kind: ch.kind }, user }
}
