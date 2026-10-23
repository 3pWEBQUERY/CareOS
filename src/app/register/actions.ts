'use server'

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requestMeta } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'
import { peekRateLimit, rateLimit } from '@/lib/rate-limit'
import { auditSystem } from '@/lib/audit'
import { notifyT } from '@/lib/notify-t'
import { publicT } from '@/lib/i18n-server'
import { log } from '@/lib/log'
import { formObject, orgSignupSchema, registrationSchema } from '@/lib/registration-core'
import { orgByCode, orgSignupEnabled } from '@/lib/registration'
import { setupOrganization } from '@/lib/org-setup'
import { notifyOperators } from '@/lib/platform'
import { uniqueInitials } from '@/lib/generate/people'

export type RegisterState = { done?: 'request' | 'org'; error?: string; field?: string; values?: Record<string, string> } | undefined

const prod = process.env.NODE_ENV === 'production'
/** Eingaben für die erneute Anzeige – nie das Passwort */
const keep = (form: FormData) => {
  const v = formObject(form)
  delete v.password
  return v
}
const invalid = (issues: { message: string; path: PropertyKey[] }[], values: Record<string, string>): RegisterState => ({ error: issues[0]?.message ?? 'register.errors.generic', field: String(issues[0]?.path[0] ?? ''), values })

/**
 * Konto beantragen (PRD §33). Das Konto ist bis zur Freigabe inaktiv (pendingSince).
 * Keine Kontenaufzählung: gleiche Antwort, ob die E-Mail-Adresse schon existiert oder nicht.
 * Rate-Limit je IP: 10 Anfragen pro Stunde, zusätzlich 10 falsche Codes pro Stunde.
 */
export async function registerAction(_: RegisterState, form: FormData): Promise<RegisterState> {
  const meta = await requestMeta()
  const values = keep(form)
  const ip = meta.ip ?? 'unknown'
  const codeKey = `register-code-fail:${ip}`
  const codeLimit = prod ? 10 : 500
  if (!(await peekRateLimit(codeKey, codeLimit - 1)).ok) return { error: 'register.errors.rate', values }
  if (!(await rateLimit(`register:${ip}`, prod ? 10 : 500, 60 * 60_000)).ok) return { error: 'register.errors.rate', values }

  const parsed = registrationSchema.safeParse(formObject(form))
  if (!parsed.success) return invalid(parsed.error.issues, values)
  const d = parsed.data
  // Passwort immer hashen – gleiche Antwortzeit für alle Fälle
  const passwordHash = await hashPassword(d.password)
  const org = await orgByCode(d.code)
  if (!org) {
    await rateLimit(codeKey, codeLimit, 60 * 60_000)
    await auditSystem({ action: 'auth.register_code_invalid', entityType: 'Organization', ...meta })
    return { error: 'register.errors.code', field: 'code', values }
  }

  const existing = await db.user.findUnique({ where: { email: d.email }, select: { id: true, orgId: true } })
  if (existing) {
    await auditSystem({ action: 'auth.register_duplicate', entityType: 'User', entityId: existing.id, orgId: org.id, ...meta })
    return { done: 'request' }
  }
  const { locale } = await publicT()
  const taken = new Set((await db.user.findMany({ where: { orgId: org.id }, select: { initials: true } })).map((u) => u.initials))
  let user
  try {
    user = await db.user.create({
      data: {
        orgId: org.id, email: d.email, firstName: d.firstName, lastName: d.lastName, initials: uniqueInitials(d.firstName, d.lastName, taken),
        passwordHash, locale, active: false, pendingSince: new Date(),
        registration: { note: d.note, consentAt: new Date().toISOString() },
      },
    })
  } catch (e) {
    // Gleichzeitige Anfrage mit derselben Adresse
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { done: 'request' }
    log.error('register.failed', { error: e instanceof Error ? e.message : String(e) })
    return { error: 'register.errors.generic', values }
  }
  await auditSystem({ action: 'auth.register_request', entityType: 'User', entityId: user.id, orgId: org.id, userId: user.id, after: { firstName: d.firstName, lastName: d.lastName, email: d.email, note: d.note }, ...meta })
  const admins = await db.user.findMany({ where: { orgId: org.id, active: true, roles: { some: { role: { permissions: { has: 'admin.users' } } } } }, select: { id: true } })
  await notifyT({
    orgId: org.id, userIds: admins.map((a) => a.id), priority: 'action', kind: 'security.registration',
    titleKey: 'register.notify.title', bodyKey: 'register.notify.body', vars: { name: `${d.firstName} ${d.lastName}` },
    href: '/admin/users?tab=requests', groupKey: 'registration:' + user.id, dutyAware: false,
  }).catch((e) => log.warn('register.notify_failed', { error: e instanceof Error ? e.message : String(e) }))
  return { done: 'request' }
}

/**
 * Neue Organisation anlegen (nur ORG_SIGNUP=true): Standardkonfiguration ohne Personen, Konto als Systemadministration.
 * Rate-Limit je IP: 3 pro Tag. Gleiche Antwort, wenn die E-Mail-Adresse bereits verwendet wird.
 */
export async function orgSignupAction(_: RegisterState, form: FormData): Promise<RegisterState> {
  const values = keep(form)
  if (!orgSignupEnabled()) return { error: 'register.errors.disabled', values }
  const meta = await requestMeta()
  if (!(await rateLimit(`org-signup:${meta.ip ?? 'unknown'}`, prod ? 3 : 100, 24 * 3600_000)).ok) return { error: 'register.errors.rate', values }
  const parsed = orgSignupSchema.safeParse(formObject(form))
  if (!parsed.success) return invalid(parsed.error.issues, values)
  const d = parsed.data
  const passwordHash = await hashPassword(d.password)
  if (await db.user.findUnique({ where: { email: d.email }, select: { id: true } })) {
    await auditSystem({ action: 'auth.org_signup_duplicate', entityType: 'User', ...meta })
    return { done: 'org' }
  }
  const { locale } = await publicT()
  try {
    // Plattform (PRD §42): bis zur Freigabe unter /platform → Anträge gesperrt (Anmeldung zeigt «wird geprüft»)
    const r = await setupOrganization(db, { source: 'signup', pendingApproval: true, orgName: d.orgName, units: 1, admin: { email: d.email, firstName: d.firstName, lastName: d.lastName, passwordHash, locale } })
    if (r) {
      await auditSystem({ action: 'auth.org_signup', entityType: 'Organization', entityId: r.orgId, orgId: r.orgId, userId: r.adminId, after: { name: d.orgName }, ...meta })
      await notifyOperators('tenancy.platform.notify.title', 'tenancy.platform.notify.body', { name: d.orgName }, '/platform?tab=requests', 'org-request:' + r.orgId)
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { done: 'org' }
    log.error('org_signup.failed', { error: e instanceof Error ? e.message : String(e) })
    return { error: 'register.errors.generic', values }
  }
  return { done: 'org' }
}
