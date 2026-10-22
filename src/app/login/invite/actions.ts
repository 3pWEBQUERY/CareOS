'use server'

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requestMeta } from '@/lib/auth/session'
import { findLink } from './link'
import { hashPassword, passwordProblem } from '@/lib/auth/password'
import { rateLimit } from '@/lib/rate-limit'
import { auditSystem } from '@/lib/audit'

export type InviteState = { error?: string } | undefined

export async function acceptInviteAction(_: InviteState, form: FormData): Promise<InviteState> {
  const meta = await requestMeta()
  if (!(await rateLimit('invite:' + meta.ip, 10, 10 * 60_000)).ok) return { error: 'rate' }
  const token = String(form.get('token') ?? '')
  const pw = String(form.get('password') ?? '')
  const repeat = String(form.get('repeat') ?? '')
  const link = await findLink(token)
  if (!link) return { error: 'invalid' }
  const problem = passwordProblem(pw)
  if (problem) return { error: problem }
  if (pw !== repeat) return { error: 'mismatch' }
  await db.$transaction([
    db.user.update({ where: { id: link.user.id }, data: { passwordHash: await hashPassword(pw) } }),
    db.authChallenge.deleteMany({ where: { userId: link.user.id, kind: { in: ['invite', 'reset'] } } }),
    db.session.updateMany({ where: { userId: link.user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ])
  await auditSystem({ action: link.ch.kind === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset_completed', entityType: 'User', entityId: link.user.id, orgId: link.user.orgId, userId: link.user.id, ...meta })
  redirect('/login')
}
