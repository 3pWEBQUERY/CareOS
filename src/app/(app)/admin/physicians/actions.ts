'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { issueLink, INVITE_DAYS } from '@/lib/invites'
import { EXTERNAL_PHYSICIAN } from '@/lib/permissions'
import { physicianAccount } from '@/lib/md/physicians'
import { PHYSICIAN_ROLES } from '@/lib/md/scope'
import { parseDateKey, startOfDay } from '@/lib/time'
import { physicianTextMatches } from '@/lib/md/text-match'

/**
 * Administration › Ärztinnen und Ärzte (PRD §60): externe Konten anlegen, einladen, deaktivieren; Personen zuordnen.
 * Berechtigung admin.users. Externe Konten erhalten nie Rollen (Zugriff nur über die Zuordnung im Ärzteportal).
 */
async function admin() {
  const ctx = await getCtx()
  assertCan(ctx, 'admin.users')
  return ctx
}

const createSchema = z.object({
  firstName: z.string().trim().min(1, 'admin.errors.name').max(60),
  lastName: z.string().trim().min(1, 'admin.errors.name').max(60),
  email: z.string().trim().toLowerCase().pipe(z.email({ message: 'admin.users.badEmail' })),
  jobTitle: z.string().trim().max(80),
  phone: z.string().trim().max(40),
})

/** Create: externes Konto (ohne Rollen, ohne Passwort) und Einladungslink (einmalig angezeigt). */
export async function createExternalAction(form: FormData): Promise<ActionResult<{ id: string; link: string }>> {
  return run(async () => {
    const ctx = await admin()
    const p = createSchema.parse({ firstName: fd(form, 'firstName'), lastName: fd(form, 'lastName'), email: fd(form, 'email'), jobTitle: fd(form, 'jobTitle'), phone: fd(form, 'phone') })
    if (await db.user.findUnique({ where: { email: p.email } })) return { ok: false, error: 'admin.users.emailTaken', field: 'email' }
    const u = await db.user.create({
      data: {
        orgId: ctx.org.id, email: p.email, firstName: p.firstName, lastName: p.lastName, initials: ((p.firstName[0] ?? '') + (p.lastName[0] ?? '')).toUpperCase(),
        jobTitle: p.jobTitle || null, phone: p.phone || null, kind: EXTERNAL_PHYSICIAN, active: true, locale: ctx.locale,
      },
    })
    await audit(ctx, { action: 'admin.physician.create', entityType: 'User', entityId: u.id, after: { email: u.email, firstName: u.firstName, lastName: u.lastName, kind: u.kind } })
    const link = await issueLink(u.id, 'invite')
    await audit(ctx, { action: 'admin.user.invite', entityType: 'User', entityId: u.id, context: { expiresInDays: INVITE_DAYS, external: true } })
    refresh()
    return { ok: true, data: { id: u.id, link } }
  })
}

/** Neuer Einladungslink für ein externes Konto (ersetzt den alten). */
export async function inviteExternalAction(userId: string): Promise<ActionResult<{ link: string }>> {
  return run(async () => {
    const ctx = await admin()
    const u = await db.user.findFirst({ where: { id: String(userId), orgId: ctx.org.id, kind: EXTERNAL_PHYSICIAN } })
    if (!u) return { ok: false, error: 'md.admin.errors.notPhysician' }
    const link = await issueLink(u.id, 'invite')
    await audit(ctx, { action: 'admin.user.invite', entityType: 'User', entityId: u.id, context: { expiresInDays: INVITE_DAYS, external: true } })
    return { ok: true, data: { link } }
  })
}

/** Externes Konto deaktivieren (Sitzungen beenden) oder wieder aktivieren. */
export async function setExternalActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const u = await db.user.findFirst({ where: { id: String(userId), orgId: ctx.org.id, kind: EXTERNAL_PHYSICIAN } })
    if (!u) return { ok: false, error: 'md.admin.errors.notPhysician' }
    await db.user.update({ where: { id: u.id }, data: { active: !!active } })
    if (!active) await db.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } })
    await audit(ctx, { action: active ? 'admin.user.activate' : 'admin.user.deactivate', entityType: 'User', entityId: u.id, before: { active: u.active }, after: { active: !!active }, context: { external: true } })
    refresh()
    return { ok: true, message: ctx.t(active ? 'md.admin.toast.activated' : 'md.admin.toast.deactivated') }
  })
}

const assignSchema = z.object({
  userId: z.string().min(1).max(40),
  residentId: z.string().min(1, 'md.admin.errors.resident').max(40),
  role: z.enum(PHYSICIAN_ROLES),
  until: z.string().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'md.admin.errors.until'),
})

/** Assign: Person zuordnen (oder bestehende Zuordnung erneuern), optional befristet. */
export async function assignAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const p = assignSchema.parse({ userId: fd(form, 'userId'), residentId: fd(form, 'residentId'), role: fd(form, 'role') || 'primary', until: fd(form, 'until') })
    const u = await physicianAccount(ctx, p.userId)
    if (!u) return { ok: false, error: 'md.admin.errors.notPhysician' }
    const r = await db.resident.findFirst({ where: { id: p.residentId, orgId: ctx.org.id, status: { in: ['active', 'absent'] } } })
    if (!r) return { ok: false, error: 'md.admin.errors.resident', field: 'residentId' }
    // «bis» gilt einschliesslich des Tages: Ende = Folgetag 00:00
    const until = p.until ? new Date(parseDateKey(p.until).getTime() + 86_400_000) : null
    if (until && until <= new Date()) return { ok: false, error: 'md.admin.errors.until', field: 'until' }
    const before = await db.residentPhysician.findUnique({ where: { residentId_userId: { residentId: r.id, userId: u.id } } })
    const now = new Date()
    const row = await db.residentPhysician.upsert({
      where: { residentId_userId: { residentId: r.id, userId: u.id } },
      create: { orgId: ctx.org.id, residentId: r.id, userId: u.id, role: p.role, until, createdById: ctx.user.id },
      update: { role: p.role, until, ...(before && before.until && before.until <= now ? { from: now } : {}) },
    })
    await audit(ctx, { action: 'admin.physician.assign', entityType: 'ResidentPhysician', entityId: row.id, before, after: row, context: { residentId: r.id, userId: u.id } })
    refresh()
    return { ok: true, message: ctx.t('md.admin.toast.assigned') }
  })
}

/** Zuordnung beenden (nicht löschen: bleibt nachvollziehbar). */
export async function endAssignmentAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const row = await db.residentPhysician.findFirst({ where: { id: String(id), orgId: ctx.org.id } })
    if (!row) return { ok: false, error: 'common.notFound' }
    const after = await db.residentPhysician.update({ where: { id: row.id }, data: { until: new Date() } })
    await audit(ctx, { action: 'admin.physician.unassign', entityType: 'ResidentPhysician', entityId: row.id, before: row, after, context: { residentId: row.residentId, userId: row.userId } })
    refresh()
    return { ok: true, message: ctx.t('md.admin.toast.ended') }
  })
}

/** Zuordnungen aus dem Freitext «Hausarzt» der Stammdaten übernehmen (Nachname, optional Vorname/Initiale). */
export async function importFromTextAction(userId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const u = await physicianAccount(ctx, String(userId))
    if (!u) return { ok: false, error: 'md.admin.errors.notPhysician' }
    const residents = await db.resident.findMany({ where: { orgId: ctx.org.id, status: { in: ['active', 'absent'] }, physician: { not: null }, physicians: { none: { userId: u.id } } }, select: { id: true, physician: true } })
    const hits = residents.filter((r) => physicianTextMatches(r.physician, u))
    if (!hits.length) return { ok: false, error: 'md.admin.errors.noMatches' }
    await db.residentPhysician.createMany({ data: hits.map((r) => ({ orgId: ctx.org.id, residentId: r.id, userId: u.id, role: 'primary', from: startOfDay(), createdById: ctx.user.id })), skipDuplicates: true })
    await audit(ctx, { action: 'admin.physician.assign.import', entityType: 'User', entityId: u.id, context: { residentIds: hits.map((r) => r.id) } })
    refresh()
    return { ok: true, message: ctx.t('md.admin.toast.imported', { n: hits.length }) }
  })
}
