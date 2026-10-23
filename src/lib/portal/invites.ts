import 'server-only'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { randomToken } from '@/lib/crypto'
import { portalHash } from './auth'
import { inviteExpiry, inviteProblem, tokenShapeOk } from './invite-core'

/** Neuer Einmal-Link für einen Zugang. Nur der Hash wird gespeichert; ein neuer Link ersetzt den alten. */
export async function issuePortalInvite(accessId: string) {
  const token = randomToken(32)
  const expiresAt = inviteExpiry()
  await db.portalAccess.update({ where: { id: accessId }, data: { inviteTokenHash: portalHash('invite:' + token), inviteExpiresAt: expiresAt } })
  return { url: new URL('/portal/invite?token=' + token, env.appUrl).toString(), expiresAt }
}

/** Lädt eine Einladung zum Token; `problem` erklärt, warum sie nicht angenommen werden kann. */
export async function findPortalInvite(token: string | undefined | null) {
  if (!tokenShapeOk(token)) return { access: null, problem: 'invalid' as const }
  const access = await db.portalAccess.findUnique({
    where: { inviteTokenHash: portalHash('invite:' + token) },
    include: { resident: { select: { id: true, orgId: true, firstName: true, lastName: true, status: true, anonymisedAt: true } } },
  })
  const problem = inviteProblem(access)
  return { access, problem }
}
