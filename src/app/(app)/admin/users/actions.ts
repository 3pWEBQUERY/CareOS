'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getCtx, assertCan, type Ctx } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { encrypt } from '@/lib/crypto'
import { INVITE_DAYS, awaitingAccessWhere, issueLink } from '@/lib/invites'
import { hashCode, newRegistrationCode, readRegistration } from '@/lib/registration-core'
import { settleNotifications } from '@/lib/notify'
import { hashPassword, passwordProblem } from '@/lib/auth/password'
import { guardLastAdmin, LastAdminError } from '@/lib/admin'
import { LOCALES } from '@/i18n/core'

async function admin() {
  const ctx = await getCtx()
  assertCan(ctx, 'admin.users')
  return ctx
}

async function userInOrg(ctx: Ctx, id: string) {
  return db.user.findFirst({ where: { id, orgId: ctx.org.id } })
}

/** Sicht auf einen Benutzer ohne Geheimnisse – für before/after im Audit. */
const safe = (u: { email: string; firstName: string; lastName: string; initials: string; jobTitle: string | null; employeeNo: string | null; phone: string | null; workPhone: string | null; primaryUnitId: string | null; locale: string; active: boolean }) => ({
  email: u.email, firstName: u.firstName, lastName: u.lastName, initials: u.initials, jobTitle: u.jobTitle, employeeNo: u.employeeNo, phone: u.phone, workPhone: u.workPhone, primaryUnitId: u.primaryUnitId, locale: u.locale, active: u.active,
})

const holdsOrgWide = (ctx: Ctx, perm: string) => ctx.grants.some((g) => !g.unitId && !g.locationId && g.permissions.includes(perm))

/** Schutz vor Rechteausweitung (PRD §37): Ohne admin.roles nur Rollen vergeben, deren Rechte man selbst organisationsweit hat, und nie sich selbst. */
function escalationError(ctx: Ctx, targetUserId: string, permissions: string[]): string | null {
  if (ctx.can('admin.roles')) return null
  if (targetUserId === ctx.user.id) return 'admin.users.selfRoles'
  if (permissions.some((p) => !holdsOrgWide(ctx, p))) return 'admin.users.escalation'
  return null
}

/**
 * Ohne admin.roles darf niemand Konten verwalten, deren Rechte über die eigenen hinausgehen
 * (sonst wäre z. B. über «Passwort zurücksetzen» eine Kontoübernahme der Systemadministration möglich).
 */
async function manageError(ctx: Ctx, targetUserId: string): Promise<string | null> {
  if (ctx.can('admin.roles')) return null
  const rows = await db.roleAssignment.findMany({ where: { userId: targetUserId }, include: { role: { select: { permissions: true } } } })
  const perms = new Set(rows.flatMap((r) => r.role.permissions))
  return [...perms].some((p) => !holdsOrgWide(ctx, p)) ? 'admin.users.outranks' : null
}

const initialsFrom = (first: string, last: string) => ((first[0] ?? '') + (last[0] ?? '')).toUpperCase()

function parseUserFields(form: FormData) {
  const firstName = fd(form, 'firstName').slice(0, 60)
  const lastName = fd(form, 'lastName').slice(0, 60)
  return {
    email: fd(form, 'email').toLowerCase().slice(0, 160),
    firstName,
    lastName,
    initials: (fd(form, 'initials') || initialsFrom(firstName, lastName)).toUpperCase().slice(0, 4),
    jobTitle: fd(form, 'jobTitle').slice(0, 80) || null,
    employeeNo: fd(form, 'employeeNo').slice(0, 30) || null,
    phone: fd(form, 'phone').slice(0, 40) || null,
    workPhone: fd(form, 'workPhone').slice(0, 40) || null,
    primaryUnitId: fd(form, 'primaryUnitId') || null,
    locale: z.enum(LOCALES).catch('de').parse(fd(form, 'locale')),
  }
}

async function validateUser(ctx: Ctx, u: ReturnType<typeof parseUserFields>, id?: string): Promise<ActionResult | null> {
  if (!z.email().safeParse(u.email).success) return { ok: false, error: 'admin.users.badEmail', field: 'email' }
  if (!u.firstName) return { ok: false, error: 'admin.errors.name', field: 'firstName' }
  if (!u.lastName) return { ok: false, error: 'admin.errors.name', field: 'lastName' }
  const clash = await db.user.findUnique({ where: { email: u.email } })
  if (clash && clash.id !== id) return { ok: false, error: 'admin.users.emailTaken', field: 'email' }
  if (u.primaryUnitId && !(await db.unit.findFirst({ where: { id: u.primaryUnitId, orgId: ctx.org.id } }))) return { ok: false, error: 'admin.structure.pickUnit', field: 'primaryUnitId' }
  return null
}

export async function createUserAction(form: FormData): Promise<ActionResult<{ id: string; secret?: string }>> {
  return run(async () => {
    const ctx = await admin()
    const u = parseUserFields(form)
    const err = await validateUser(ctx, u)
    if (err) return err as ActionResult<{ id: string }>
    const mode = fd(form, 'mode') === 'password' ? 'password' : 'invite'
    let passwordHash: string | null = null
    if (mode === 'password') {
      const pw = String(form.get('password') ?? '')
      const problem = passwordProblem(pw)
      if (problem) return { ok: false, error: 'profile.password.' + problem, field: 'password' }
      passwordHash = await hashPassword(pw)
    }
    const roleId = fd(form, 'roleId')
    const role = roleId ? await db.role.findFirst({ where: { id: roleId, orgId: ctx.org.id } }) : null
    if (role) {
      const esc = escalationError(ctx, '', role.permissions)
      if (esc) return { ok: false, error: esc, field: 'roleId' }
    }
    const wantsUnit = fd(form, 'roleScope') === 'unit'
    if (role && wantsUnit && !u.primaryUnitId) return { ok: false, error: 'admin.users.scopeNeedsUnit', field: 'primaryUnitId' }
    const scopeUnit = role && wantsUnit ? u.primaryUnitId : null
    const created = await db.user.create({ data: { ...u, orgId: ctx.org.id, passwordHash, active: true } })
    if (role) await db.roleAssignment.create({ data: { userId: created.id, roleId: role.id, unitId: scopeUnit } })
    await audit(ctx, { action: 'admin.user.create', entityType: 'User', entityId: created.id, after: { ...safe(created), role: role?.key ?? null, roleUnitId: scopeUnit, mode } })
    const secret = mode === 'invite' ? await issueLink(created.id, 'invite') : undefined
    if (secret) await audit(ctx, { action: 'admin.user.invite', entityType: 'User', entityId: created.id, context: { expiresInDays: INVITE_DAYS } })
    refresh()
    return { ok: true, data: { id: created.id, secret }, message: 'admin.users.created' }
  })
}

export async function updateUserAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const before = await userInOrg(ctx, id)
    if (!before) return { ok: false, error: 'common.notFound' }
    const outranks = await manageError(ctx, id)
    if (outranks) return { ok: false, error: outranks }
    const u = parseUserFields(form)
    const err = await validateUser(ctx, u, id)
    if (err) return err
    const after = await db.user.update({ where: { id }, data: u })
    await audit(ctx, { action: 'admin.user.update', entityType: 'User', entityId: id, before: safe(before), after: safe(after) })
    refresh()
  })
}

export async function setUserActiveAction(id: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    if (id === ctx.user.id) return { ok: false, error: 'admin.users.notSelf' }
    const before = await userInOrg(ctx, id)
    if (!before) return { ok: false, error: 'common.notFound' }
    const outranks = await manageError(ctx, id)
    if (outranks) return { ok: false, error: outranks }
    try {
      await guardLastAdmin(ctx.org.id, async (tx) => {
        await tx.user.update({ where: { id }, data: { active } })
        if (!active) await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
      })
    } catch (e) {
      if (e instanceof LastAdminError) return { ok: false, error: 'admin.errors.lastAdmin' }
      throw e
    }
    await audit(ctx, { action: active ? 'admin.user.reactivate' : 'admin.user.deactivate', entityType: 'User', entityId: id, before: { active: before.active }, after: { active } })
    refresh()
    return { ok: true, message: active ? 'admin.users.reactivated' : 'admin.users.deactivated' }
  })
}

/** Passwort zurücksetzen: entweder Einmal-Link oder vorläufiges Passwort. Beendet alle Sitzungen der Person. */
export async function resetPasswordAction(form: FormData): Promise<ActionResult<{ secret?: string }>> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    if (id === ctx.user.id) return { ok: false, error: 'admin.users.useProfile' }
    const u = await userInOrg(ctx, id)
    if (!u) return { ok: false, error: 'common.notFound' }
    const outranks = await manageError(ctx, id)
    if (outranks) return { ok: false, error: outranks }
    const mode = fd(form, 'mode') === 'password' ? 'password' : 'link'
    let secret: string | undefined
    if (mode === 'password') {
      const pw = String(form.get('password') ?? '')
      const problem = passwordProblem(pw)
      if (problem) return { ok: false, error: 'profile.password.' + problem, field: 'password' }
      await db.user.update({ where: { id }, data: { passwordHash: await hashPassword(pw) } })
    } else {
      secret = await issueLink(id, 'reset')
    }
    const r = await db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
    await audit(ctx, { action: 'admin.user.password_reset', entityType: 'User', entityId: id, context: { mode, revokedSessions: r.count } })
    refresh()
    return { ok: true, data: { secret }, message: 'admin.users.passwordReset' }
  })
}

export async function resetMfaAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    if (id === ctx.user.id) return { ok: false, error: 'admin.users.useProfile' }
    const u = await userInOrg(ctx, id)
    if (!u) return { ok: false, error: 'common.notFound' }
    const outranks = await manageError(ctx, id)
    if (outranks) return { ok: false, error: outranks }
    await db.$transaction([
      db.user.update({ where: { id }, data: { mfaEnabled: false, mfaSecret: null } }),
      db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ])
    await audit(ctx, { action: 'admin.user.mfa_reset', entityType: 'User', entityId: id, before: { mfaEnabled: u.mfaEnabled }, after: { mfaEnabled: false } })
    refresh()
    return { ok: true, message: 'admin.users.mfaReset' }
  })
}

export async function revokeUserSessionsAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const u = await userInOrg(ctx, id)
    if (!u) return { ok: false, error: 'common.notFound' }
    const outranks = await manageError(ctx, id)
    if (outranks) return { ok: false, error: outranks }
    const r = await db.session.updateMany({ where: { userId: id, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } })
    await audit(ctx, { action: 'admin.user.sessions_revoked', entityType: 'User', entityId: id, context: { count: r.count } })
    refresh()
    return { ok: true, message: 'admin.users.sessionsRevoked' }
  })
}

// ───────── Rollen-Zuweisungen ─────────

export async function addAssignmentAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const userId = fd(form, 'userId')
    const u = await userInOrg(ctx, userId)
    const role = await db.role.findFirst({ where: { id: fd(form, 'roleId'), orgId: ctx.org.id } })
    if (!u || !role) return { ok: false, error: 'admin.users.pickRole', field: 'roleId' }
    const esc = escalationError(ctx, userId, role.permissions)
    if (esc) return { ok: false, error: esc, field: 'roleId' }
    const [kind, sid] = fd(form, 'scope').split(':')
    let unitId: string | null = null
    let locationId: string | null = null
    if (kind === 'unit') {
      if (!(await db.unit.findFirst({ where: { id: sid, orgId: ctx.org.id } }))) return { ok: false, error: 'admin.structure.pickUnit', field: 'scope' }
      unitId = sid
    } else if (kind === 'loc') {
      if (!(await db.location.findFirst({ where: { id: sid, orgId: ctx.org.id } }))) return { ok: false, error: 'admin.structure.pickLocation', field: 'scope' }
      locationId = sid
    }
    const dup = await db.roleAssignment.findFirst({ where: { userId, roleId: role.id, unitId, locationId } })
    if (dup) return { ok: false, error: 'admin.users.duplicateAssignment' }
    const a = await db.roleAssignment.create({ data: { userId, roleId: role.id, unitId, locationId } })
    await audit(ctx, { action: 'admin.user.role_assign', entityType: 'RoleAssignment', entityId: a.id, after: { userId, role: role.key, unitId, locationId } })
    refresh()
  })
}

export async function removeAssignmentAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const a = await db.roleAssignment.findFirst({ where: { id, user: { orgId: ctx.org.id } }, include: { role: true } })
    if (!a) return { ok: false, error: 'common.notFound' }
    if (a.userId === ctx.user.id && !ctx.can('admin.roles')) return { ok: false, error: 'admin.users.selfRoles' }
    const outranks = await manageError(ctx, a.userId)
    if (outranks) return { ok: false, error: outranks }
    try {
      await guardLastAdmin(ctx.org.id, (tx) => tx.roleAssignment.delete({ where: { id } }))
    } catch (e) {
      if (e instanceof LastAdminError) return { ok: false, error: 'admin.errors.lastAdmin' }
      throw e
    }
    await audit(ctx, { action: 'admin.user.role_remove', entityType: 'RoleAssignment', entityId: id, before: { userId: a.userId, role: a.role.key, unitId: a.unitId, locationId: a.locationId } })
    refresh()
  })
}

// ───────── Qualifikationen ─────────

export async function addUserQualificationAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const userId = fd(form, 'userId')
    const qualificationId = fd(form, 'qualificationId')
    const [u, q] = await Promise.all([userInOrg(ctx, userId), db.qualification.findFirst({ where: { id: qualificationId, orgId: ctx.org.id } })])
    if (!u || !q) return { ok: false, error: 'admin.users.pickQualification', field: 'qualificationId' }
    const v = fd(form, 'validUntil')
    const validUntil = v ? new Date(v + 'T00:00:00') : null
    if (validUntil && Number.isNaN(validUntil.getTime())) return { ok: false, error: 'admin.users.badDate', field: 'validUntil' }
    await db.userQualification.upsert({ where: { userId_qualificationId: { userId, qualificationId } }, create: { userId, qualificationId, validUntil }, update: { validUntil } })
    await audit(ctx, { action: 'admin.user.qualification_set', entityType: 'User', entityId: userId, after: { qualification: q.name, validUntil } })
    refresh()
  })
}

export async function removeUserQualificationAction(userId: string, qualificationId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const uq = await db.userQualification.findFirst({ where: { userId, qualificationId, user: { orgId: ctx.org.id } }, include: { qualification: true } })
    if (!uq) return { ok: false, error: 'common.notFound' }
    await db.userQualification.delete({ where: { userId_qualificationId: { userId, qualificationId } } })
    await audit(ctx, { action: 'admin.user.qualification_remove', entityType: 'User', entityId: userId, before: { qualification: uq.qualification.name, validUntil: uq.validUntil } })
    refresh()
  })
}

export async function saveQualificationAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const name = fd(form, 'name').slice(0, 80)
    const level = Math.min(5, Math.max(1, Number(fd(form, 'level')) || 1))
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    const q = await db.qualification.create({ data: { orgId: ctx.org.id, name, level } })
    await audit(ctx, { action: 'admin.qualification.create', entityType: 'Qualification', entityId: q.id, after: { name, level } })
    refresh()
  })
}

export async function deleteQualificationAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const q = await db.qualification.findFirst({ where: { id, orgId: ctx.org.id }, include: { _count: { select: { users: true } } } })
    if (!q) return { ok: false, error: 'common.notFound' }
    if (q._count.users) return { ok: false, error: 'admin.users.qualificationInUse' }
    await db.qualification.delete({ where: { id } })
    await audit(ctx, { action: 'admin.qualification.delete', entityType: 'Qualification', entityId: id, before: { name: q.name, level: q.level } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}

// ───────── Einladungen (Konten ohne Zugang, z. B. aus dem Erststart) ─────────

export type InviteLinkRow = { id: string; name: string; email: string; link: string }

/** Neue Einladungslinks für die gewählten Konten ohne Zugang. Frühere Links werden ungültig; Anzeige nur einmal. */
export async function issueInvitesAction(ids: string[]): Promise<ActionResult<{ links: InviteLinkRow[] }>> {
  return run(async () => {
    const ctx = await admin()
    const users = await db.user.findMany({
      where: { ...awaitingAccessWhere(ctx.org.id), id: { in: ids.slice(0, 1000) } },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    })
    const links: InviteLinkRow[] = []
    for (const u of users) {
      if (await manageError(ctx, u.id)) continue
      links.push({ id: u.id, name: `${u.lastName} ${u.firstName}`, email: u.email, link: await issueLink(u.id, 'invite') })
      await audit(ctx, { action: 'admin.user.invite', entityType: 'User', entityId: u.id, context: { expiresInDays: INVITE_DAYS, bulk: users.length > 1 } })
    }
    if (!links.length) return { ok: false, error: 'admin.users.outranks' }
    refresh()
    return { ok: true, data: { links } }
  })
}

// ───────── Selbstregistrierung (PRD §33) ─────────

async function saveRegistration(ctx: Ctx, patch: { enabled?: boolean; code?: string }) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
  const settings = (org.settings && typeof org.settings === 'object' ? org.settings : {}) as Record<string, unknown>
  const cur = readRegistration(settings)
  const next = {
    enabled: patch.enabled ?? cur.enabled,
    codeHash: patch.code ? hashCode(patch.code) : cur.codeHash,
    codeEnc: patch.code ? encrypt(patch.code) : cur.codeEnc,
    rotatedAt: patch.code ? new Date().toISOString() : cur.rotatedAt,
  }
  await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...settings, registration: next } } })
  return { before: cur, after: next }
}

export async function setRegistrationAction(enabled: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const needsCode = enabled && !readRegistration(org.settings).codeHash
    const { before, after } = await saveRegistration(ctx, { enabled, code: needsCode ? newRegistrationCode() : undefined })
    await audit(ctx, { action: enabled ? 'admin.registration.enable' : 'admin.registration.disable', entityType: 'Organization', entityId: ctx.org.id, before: { enabled: before.enabled }, after: { enabled: after.enabled } })
    refresh()
    return { ok: true, message: enabled ? 'register.admin.enabled' : 'register.admin.disabled' }
  })
}

export async function rotateRegistrationCodeAction(): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    await saveRegistration(ctx, { code: newRegistrationCode() })
    await audit(ctx, { action: 'admin.registration.code_rotated', entityType: 'Organization', entityId: ctx.org.id })
    refresh()
    return { ok: true, message: 'register.admin.rotated' }
  })
}

async function pendingUser(ctx: Ctx, id: string) {
  return db.user.findFirst({ where: { id, orgId: ctx.org.id, pendingSince: { not: null } } })
}

/** Anfrage freigeben: Rolle im gewählten Bereich, Konto aktiv. */
export async function approveRequestAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const u = await pendingUser(ctx, id)
    if (!u) return { ok: false, error: 'register.admin.notPending' }
    const role = await db.role.findFirst({ where: { id: fd(form, 'roleId'), orgId: ctx.org.id } })
    if (!role) return { ok: false, error: 'register.admin.pickRole', field: 'roleId' }
    const esc = escalationError(ctx, id, role.permissions)
    if (esc) return { ok: false, error: esc, field: 'roleId' }
    const unit = await db.unit.findFirst({ where: { id: fd(form, 'unitId'), orgId: ctx.org.id } })
    if (!unit) return { ok: false, error: 'register.admin.pickUnit', field: 'unitId' }
    const jobTitle = fd(form, 'jobTitle').slice(0, 80) || null
    const reg = (u.registration && typeof u.registration === 'object' ? u.registration : {}) as Record<string, unknown>
    const done = await db.$transaction(async (tx) => {
      // Doppelklick / zwei Geräte: nur eine Freigabe zählt
      const r = await tx.user.updateMany({
        where: { id, pendingSince: { not: null } },
        data: { active: true, pendingSince: null, primaryUnitId: unit.id, jobTitle, registration: { ...reg, approvedAt: new Date().toISOString(), approvedById: ctx.user.id } },
      })
      if (!r.count) return false
      await tx.roleAssignment.create({ data: { userId: id, roleId: role.id, unitId: unit.id } })
      await audit(ctx, { action: 'admin.user.registration_approved', entityType: 'User', entityId: id, before: { active: false }, after: { active: true, role: role.key, unitId: unit.id, jobTitle } }, tx)
      return true
    })
    if (!done) return { ok: false, error: 'register.admin.notPending' }
    await settleNotifications(ctx.org.id, 'registration:' + id)
    refresh()
    return { ok: true, message: 'register.admin.approved' }
  })
}

/** Anfrage ablehnen: das beantragte Konto wird gelöscht (hat nie Daten erfasst). */
export async function rejectRequestAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const u = await pendingUser(ctx, id)
    if (!u) return { ok: false, error: 'register.admin.notPending' }
    const r = await db.user.deleteMany({ where: { id, pendingSince: { not: null }, active: false } })
    if (!r.count) return { ok: false, error: 'register.admin.notPending' }
    await audit(ctx, { action: 'admin.user.registration_rejected', entityType: 'User', entityId: id, before: { email: u.email, firstName: u.firstName, lastName: u.lastName, registration: u.registration } })
    await settleNotifications(ctx.org.id, 'registration:' + id)
    refresh()
    return { ok: true, message: 'register.admin.rejected' }
  })
}
