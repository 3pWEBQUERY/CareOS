'use server'

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { createSession, destroySession, getSession, requestMeta } from '@/lib/auth/session'
import { verifyPassword } from '@/lib/auth/password'
import { verifyTotp } from '@/lib/auth/mfa'
import { rateLimit } from '@/lib/rate-limit'
import { auditSystem } from '@/lib/audit'

export type LoginState = { error?: string; retry?: number; email?: string } | undefined

const safeNext = (n: FormDataEntryValue | null) => {
  const s = typeof n === 'string' ? n : ''
  return s.startsWith('/') && !s.startsWith('//') ? s : '/'
}

export async function loginAction(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const password = String(form.get('password') ?? '')
  const meta = await requestMeta()
  const rl = rateLimit(`login:${meta.ip}:${email}`, process.env.NODE_ENV === 'production' ? 8 : 200, 10 * 60_000)
  if (!rl.ok) return { error: 'locked', retry: rl.retryAfter, email }

  const user = await db.user.findUnique({ where: { email } })
  const ok = user ? await verifyPassword(user.passwordHash, password) : await verifyPassword(null, password)
  if (!user || !ok) {
    await auditSystem({ action: 'auth.login_failed', entityType: 'User', entityId: user?.id, orgId: user?.orgId, context: { email }, ...meta })
    return { error: 'invalid', email }
  }
  if (!user.active) return { error: 'inactive', email }

  await createSession(user.id, !user.mfaEnabled, 'password')
  await auditSystem({ action: 'auth.login', entityType: 'User', entityId: user.id, orgId: user.orgId, userId: user.id, context: { method: 'password' }, ...meta })
  if (user.mfaEnabled) redirect('/login/mfa?next=' + encodeURIComponent(safeNext(form.get('next'))))
  redirect(safeNext(form.get('next')))
}

export async function mfaAction(_: LoginState, form: FormData): Promise<LoginState> {
  const session = await getSession()
  if (!session) redirect('/login')
  const meta = await requestMeta()
  const rl = rateLimit(`mfa:${session.id}`, 6, 5 * 60_000)
  if (!rl.ok) return { error: 'locked', retry: rl.retryAfter }
  const code = String(form.get('code') ?? '')
  if (!session.user.mfaSecret || !verifyTotp(session.user.mfaSecret, code, session.user.email)) {
    await auditSystem({ action: 'auth.mfa_failed', entityType: 'User', entityId: session.userId, orgId: session.user.orgId, userId: session.userId, ...meta })
    return { error: 'mfaInvalid' }
  }
  await db.session.update({ where: { id: session.id }, data: { mfaPassed: true } })
  await auditSystem({ action: 'auth.mfa_passed', entityType: 'User', entityId: session.userId, orgId: session.user.orgId, userId: session.userId, ...meta })
  redirect(safeNext(form.get('next')))
}

export async function logoutAction() {
  const s = await getSession()
  if (s) await auditSystem({ action: 'auth.logout', entityType: 'User', entityId: s.userId, orgId: s.user.orgId, userId: s.userId, ...(await requestMeta()) })
  await destroySession()
  redirect('/login')
}
