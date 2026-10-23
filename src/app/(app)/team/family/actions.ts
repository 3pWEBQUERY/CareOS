'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCtx, assertCan, ForbiddenError } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify } from '@/lib/notify'
import { mailConfigured, sendMail } from '@/lib/mail'
import { env, storageConfigured } from '@/lib/env'
import { atTime, dateKey, hm, parseDateKey } from '@/lib/time'
import { saveUpload, UploadError } from '@/lib/files'
import { dictionary } from '@/i18n'
import { makeT, type Locale, type Terminology } from '@/i18n/core'
import { portalEnabled } from '@/lib/portal/module'
import { revokePortalSessions } from '@/lib/portal/auth'
import { accessSnap, revokeAccess } from '@/lib/portal/manage'
import { CONSENT_BY, MESSAGE_MAX, clampToConsent, isSelfAccess, isShareableFileCategory, normalizeAudience, normalizeGrants, portalSettings, threadStatusAfter, visitTransition } from '@/lib/portal/policy'
import { assertFamily, threadInScope, visitInScope } from './lib'

const body = z.string().min(2, 'portal.errors.body').max(MESSAGE_MAX, 'portal.errors.bodyLong')

/** Hinweis per E-Mail an Angehörige (nur, wenn ein Mail-Adapter konfiguriert ist) – ohne Inhalt, nur Link. */
async function mailFamily(account: { email: string; locale: string } | null | undefined, org: { name: string; brandName: string | null; terminology: string }, key: 'reply' | 'visit') {
  if (!account || !mailConfigured()) return
  const locale = account.locale as Locale
  const t = makeT(dictionary(locale), locale, org.terminology as Terminology)
  const name = org.brandName || org.name
  await sendMail({ to: account.email, subject: t('portal.mail.' + key + 'Subject', { org: name }), text: t('portal.mail.' + key + 'Text', { org: name, url: new URL('/portal', env.appUrl).toString() }) })
}

// ───────── Nachrichten ─────────

export async function replyThreadAction(threadId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const th = await threadInScope(ctx, threadId)
    if (!th) throw new ForbiddenError('portal.respond')
    const text = body.parse(fd(form, 'body'))
    const now = new Date()
    await db.$transaction([
      db.portalMessage.create({ data: { threadId: th.id, side: 'staff', userId: ctx.user.id, body: text } }),
      db.portalThread.update({ where: { id: th.id }, data: { status: threadStatusAfter('staff'), lastMessageAt: now, staffReadAt: now, assigneeId: th.assigneeId ?? ctx.user.id } }),
    ])
    await audit(ctx, { action: 'portal.message.answer', entityType: 'PortalThread', entityId: th.id, context: { residentId: th.residentId, length: text.length } })
    const acc = th.access?.account ? await db.portalAccount.findUnique({ where: { id: th.access.account.id }, select: { email: true, locale: true } }) : null
    await mailFamily(acc, ctx.org, 'reply')
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: th.resident.unitId, residentId: th.residentId, actorId: ctx.user.id, payload: { portal: true } })
    refresh()
    return { ok: true, message: 'portal.team.answered' }
  })
}

export async function assignThreadAction(threadId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const th = await threadInScope(ctx, threadId)
    if (!th) throw new ForbiddenError('portal.respond')
    const assigneeId = fd(form, 'assigneeId') || null
    if (assigneeId && !(await db.user.findFirst({ where: { id: assigneeId, orgId: ctx.org.id, active: true } }))) return { ok: false, error: 'common.notFound' }
    await db.portalThread.update({ where: { id: th.id }, data: { assigneeId } })
    await audit(ctx, { action: 'portal.message.assign', entityType: 'PortalThread', entityId: th.id, before: { assigneeId: th.assigneeId }, after: { assigneeId }, context: { residentId: th.residentId } })
    if (assigneeId && assigneeId !== ctx.user.id) {
      await notify({ orgId: ctx.org.id, userIds: [assigneeId], priority: 'action', kind: 'portal.assigned', title: ctx.t('portal.notify.assigned'), body: `${th.resident.lastName} ${th.resident.firstName}`, href: `/team/family/m/${th.id}`, unitId: th.resident.unitId, dutyAware: false })
    }
    refresh()
    return { ok: true, message: 'portal.team.assignedOk' }
  })
}

export async function setThreadStatusAction(threadId: string, status: 'open' | 'closed'): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const th = await threadInScope(ctx, threadId)
    if (!th) throw new ForbiddenError('portal.respond')
    await db.portalThread.update({ where: { id: th.id }, data: { status, staffReadAt: new Date() } })
    await audit(ctx, { action: 'portal.message.' + (status === 'closed' ? 'close' : 'reopen'), entityType: 'PortalThread', entityId: th.id, before: { status: th.status }, after: { status }, context: { residentId: th.residentId } })
    refresh()
    return { ok: true, message: status === 'closed' ? 'portal.team.closed' : 'portal.team.reopened' }
  })
}

/** Nachricht in den Verlauf übernehmen (Kategorie Angehörige bzw. Beobachtung bei der Person selbst, manuell, mit Verweis). */
export async function messageToChartAction(threadId: string, messageId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const th = await threadInScope(ctx, threadId)
    if (!th) throw new ForbiddenError('portal.respond')
    assertCan(ctx, 'resident.chart.write', { unitId: th.resident.unitId, locationId: th.resident.unit.locationId })
    const m = await db.portalMessage.findFirst({ where: { id: messageId, threadId: th.id } })
    if (!m) return { ok: false, error: 'common.notFound' }
    if (m.observationId) return { ok: false, error: 'portal.errors.inChart' }
    const text = z.string().min(2, 'portal.errors.body').max(4000).parse(fd(form, 'text'))
    const category = isSelfAccess(th.access) ? 'observation' : 'relatives'
    const o = await db.observation.create({ data: { residentId: th.residentId, category, source: 'manual', authorId: ctx.user.id, text, structured: { kind: 'portal-message', threadId: th.id, messageId: m.id } } })
    await db.portalMessage.update({ where: { id: m.id }, data: { observationId: o.id } })
    await audit(ctx, { action: 'observation.create', entityType: 'Observation', entityId: o.id, after: { category, text }, context: { residentId: th.residentId, from: 'portal', messageId: m.id } })
    await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: th.resident.unitId, residentId: th.residentId, actorId: ctx.user.id })
    refresh()
    return { ok: true, message: 'portal.team.inChart' }
  })
}

// ───────── Besuche ─────────

/** Bestätigen (→ Termin «Angehörige» in der Akte, erscheint im Tagesablauf) oder ablehnen (Begründung Pflicht). */
export async function decideVisitAction(visitId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const v = await visitInScope(ctx, visitId)
    if (!v) throw new ForbiddenError('portal.respond')
    const decision = fd(form, 'decision') === 'confirmed' ? 'confirmed' : 'declined'
    const reply = fd(form, 'reply').slice(0, 500) || null
    if (decision === 'declined' && !reply) return { ok: false, error: 'portal.errors.declineReason', field: 'reply' }
    if (!visitTransition(v.status, decision, 'staff')) return { ok: false, error: 'portal.errors.visitState' }
    // Doppelklick / zweites Gerät: nur aus «requested» heraus
    const done = await db.visitRequest.updateMany({ where: { id: v.id, status: 'requested' }, data: { status: decision, reply, decidedById: ctx.user.id, decidedAt: new Date(), staffReadAt: new Date(), assigneeId: v.assigneeId ?? ctx.user.id } })
    if (!done.count) return { ok: false, error: 'portal.errors.visitState' }
    if (decision === 'confirmed') {
      // Anmeldung der Person selbst: im Termin steht, wer kommt
      const who = v.visitorName ?? v.access?.account?.name ?? v.access?.inviteName ?? ''
      const a = await db.appointment.create({
        data: { residentId: v.residentId, at: v.start, kind: 'relatives', title: ctx.t('portal.team.visitTitle', { name: who }), notes: [ctx.t('portal.team.visitUntil', { time: hm(v.end), n: v.visitors }), v.note].filter(Boolean).join(' · '), createdById: ctx.user.id },
      })
      await db.visitRequest.update({ where: { id: v.id }, data: { appointmentId: a.id } })
    }
    await audit(ctx, { action: 'portal.visit.' + (decision === 'confirmed' ? 'confirm' : 'decline'), entityType: 'VisitRequest', entityId: v.id, before: { status: v.status }, after: { status: decision, reply }, context: { residentId: v.residentId } })
    const acc = v.access?.account ? await db.portalAccount.findUnique({ where: { id: v.access.account.id }, select: { email: true, locale: true } }) : null
    await mailFamily(acc, ctx.org, 'visit')
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: v.resident.unitId, residentId: v.residentId, actorId: ctx.user.id, payload: { portal: true, appointments: decision === 'confirmed' } })
    refresh()
    return { ok: true, message: decision === 'confirmed' ? 'portal.team.visitConfirmed' : 'portal.team.visitDeclined' }
  })
}

export async function assignVisitAction(visitId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const v = await visitInScope(ctx, visitId)
    if (!v) throw new ForbiddenError('portal.respond')
    const assigneeId = fd(form, 'assigneeId') || null
    if (assigneeId && !(await db.user.findFirst({ where: { id: assigneeId, orgId: ctx.org.id, active: true } }))) return { ok: false, error: 'common.notFound' }
    await db.visitRequest.update({ where: { id: v.id }, data: { assigneeId } })
    await audit(ctx, { action: 'portal.visit.assign', entityType: 'VisitRequest', entityId: v.id, before: { assigneeId: v.assigneeId }, after: { assigneeId }, context: { residentId: v.residentId } })
    if (assigneeId && assigneeId !== ctx.user.id) {
      await notify({ orgId: ctx.org.id, userIds: [assigneeId], priority: 'action', kind: 'portal.assigned', title: ctx.t('portal.notify.assignedVisit'), body: `${v.resident.lastName} ${v.resident.firstName}`, href: `/team/family/v/${v.id}`, unitId: v.resident.unitId, dutyAware: false })
    }
    refresh()
    return { ok: true, message: 'portal.team.assignedOk' }
  })
}

// ───────── Mitteilungen für Angehörige ─────────

const updSchema = z.object({
  title: z.string().min(2, 'portal.errors.subject').max(120),
  body: z.string().min(2, 'portal.errors.body').max(4000, 'portal.errors.bodyLong'),
})

export async function createUpdateAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    if (!portalEnabled(ctx.org)) return { ok: false, error: 'portal.errors.module' }
    const p = updSchema.parse({ title: fd(form, 'title'), body: fd(form, 'body') })
    const scope = fd(form, 'scope')
    let unitId: string | null = null
    let residentId: string | null = null
    if (scope === 'org') {
      assertCan(ctx, 'portal.manage') // organisationsweit nur mit Recht ohne Bereichsbeschränkung
      if (ctx.grants.every((g) => !g.permissions.includes('portal.manage') || g.unitId || g.locationId)) throw new ForbiddenError('portal.manage')
    } else if (scope === 'resident') {
      const r = await db.resident.findFirst({ where: { id: fd(form, 'residentId'), orgId: ctx.org.id, unitId: { in: ctx.unitIds } }, include: { unit: true } })
      if (!r) return { ok: false, error: 'portal.errors.resident', field: 'residentId' }
      assertFamily(ctx, r.unitId, r.unit.locationId, 'portal.manage')
      residentId = r.id
      unitId = r.unitId
    } else {
      const u = ctx.units.find((x) => x.id === fd(form, 'unitId'))
      if (!u) return { ok: false, error: 'portal.errors.unit', field: 'unitId' }
      assertFamily(ctx, u.id, u.locationId, 'portal.manage')
      unitId = u.id
    }
    const until = fd(form, 'expiresAt')
    const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(until) ? atTime(parseDateKey(until), '23:59') : null
    if (expiresAt && until < dateKey(new Date())) return { ok: false, error: 'portal.errors.expires', field: 'expiresAt' }
    const fileIds: string[] = []
    const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
    if (files.length) {
      if (!storageConfigured()) return { ok: false, error: 'portal.errors.storage' }
      try {
        for (const f of files.slice(0, 5)) fileIds.push((await saveUpload(ctx, f, 'portal', false)).id)
      } catch (e) {
        if (e instanceof UploadError) return { ok: false, error: 'portal.errors.upload', field: 'files' }
        throw e
      }
    }
    const audience = normalizeAudience(fd(form, 'audience'))
    const u = await db.portalUpdate.create({ data: { orgId: ctx.org.id, unitId, residentId, title: p.title, body: p.body, fileIds, authorId: ctx.user.id, expiresAt, audience } })
    await audit(ctx, { action: 'portal.update.create', entityType: 'PortalUpdate', entityId: u.id, after: { title: p.title, unitId, residentId, expiresAt, audience, files: fileIds.length } })
    refresh()
    return { ok: true, message: 'portal.team.updatePublished' }
  })
}

export async function deleteUpdateAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const u = await db.portalUpdate.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!u) return { ok: false, error: 'common.notFound' }
    const unit = u.unitId ? ctx.units.find((x) => x.id === u.unitId) : null
    if (u.unitId && !unit) throw new ForbiddenError('portal.manage')
    assertCan(ctx, 'portal.manage', unit ? { unitId: unit.id, locationId: unit.locationId } : undefined)
    await db.portalUpdate.delete({ where: { id: u.id } })
    await audit(ctx, { action: 'portal.update.delete', entityType: 'PortalUpdate', entityId: u.id, before: { title: u.title, body: u.body, unitId: u.unitId, residentId: u.residentId, audience: u.audience } })
    refresh()
    return { ok: true, message: 'portal.team.updateDeleted' }
  })
}

// ───────── Zugänge, Freigaben, Konten ─────────

async function accessForManage(id: string) {
  const ctx = await getCtx()
  const a = await db.portalAccess.findFirst({ where: { id, orgId: ctx.org.id }, include: { resident: { include: { unit: true } } } })
  if (!a || !ctx.unitIds.includes(a.resident.unitId)) throw new ForbiddenError('portal.manage')
  assertFamily(ctx, a.resident.unitId, a.resident.unit.locationId, 'portal.manage')
  return { ctx, a }
}

/**
 * Freigaben ändern. Innerhalb der Einwilligung genügt die Auswahl; eine Erweiterung braucht eine neue
 * Einwilligung (wer, wann) – sie ersetzt den bisherigen Umfang.
 */
export async function setGrantsAction(accessId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, a } = await accessForManage(accessId)
    if (a.revokedAt) return { ok: false, error: 'portal.errors.revoked' }
    const wanted = normalizeGrants(form.getAll('grants'))
    if (!wanted.length) return { ok: false, error: 'portal.errors.grants', field: 'grants' }
    const extends_ = wanted.some((g) => !a.consentScope.includes(g))
    let consent: { consentBy: string; consentName: string; consentAt: Date; consentScope: string[]; consentNote: string | null; consentById: string } | null = null
    if (extends_) {
      const by = fd(form, 'consentBy')
      const name = fd(form, 'consentName')
      const at = fd(form, 'consentAt')
      if (!(CONSENT_BY as readonly string[]).includes(by)) return { ok: false, error: 'portal.errors.newConsent', field: 'consentBy' }
      if (name.length < 2) return { ok: false, error: 'portal.errors.consentName', field: 'consentName' }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(at) || at > dateKey(new Date())) return { ok: false, error: 'portal.errors.consentAt', field: 'consentAt' }
      consent = { consentBy: by, consentName: name.slice(0, 120), consentAt: parseDateKey(at), consentScope: wanted, consentNote: fd(form, 'consentNote').slice(0, 500) || null, consentById: ctx.user.id }
    }
    const grants = consent ? wanted : clampToConsent(wanted, a.consentScope)
    const updated = await db.portalAccess.update({ where: { id: a.id }, data: { grants, ...(consent ?? {}) } })
    await audit(ctx, { action: consent ? 'portal.access.consent' : 'portal.access.grants', entityType: 'PortalAccess', entityId: a.id, before: accessSnap(a), after: accessSnap(updated), context: { residentId: a.residentId } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: a.resident.unitId, residentId: a.residentId, actorId: ctx.user.id, payload: { portal: true } })
    refresh()
    return { ok: true, message: 'common.saved' }
  })
}

export async function revokeAccessTeamAction(accessId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, a } = await accessForManage(accessId)
    await revokeAccess(ctx, a.id, fd(form, 'reason').slice(0, 300) || null)
    refresh()
    return { ok: true, message: 'portal.access.revoked' }
  })
}

/** Konto sperren/entsperren (alle Zugänge des Kontos ruhen; Sitzungen werden beendet). */
export async function lockAccountAction(accountId: string, lock: boolean, form?: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const acc = await db.portalAccount.findFirst({ where: { id: accountId, orgId: ctx.org.id }, include: { accesses: { include: { resident: { include: { unit: true } } } } } })
    if (!acc) return { ok: false, error: 'common.notFound' }
    const allowed = acc.accesses.some((x) => ctx.unitIds.includes(x.resident.unitId) && ctx.can('portal.manage', { unitId: x.resident.unitId, locationId: x.resident.unit.locationId }))
    if (!allowed) throw new ForbiddenError('portal.manage')
    if (!!acc.lockedAt === lock) return { ok: true }
    await db.portalAccount.update({ where: { id: acc.id }, data: lock ? { lockedAt: new Date(), lockedById: ctx.user.id } : { lockedAt: null, lockedById: null } })
    if (lock) await revokePortalSessions(acc.id)
    await audit(ctx, { action: lock ? 'portal.account.lock' : 'portal.account.unlock', entityType: 'PortalAccount', entityId: acc.id, before: { locked: !!acc.lockedAt }, after: { locked: lock }, context: { reason: form ? fd(form, 'reason').slice(0, 300) || null : null } })
    refresh()
    return { ok: true, message: lock ? 'portal.team.locked' : 'portal.team.unlocked' }
  })
}

/** Datei der Akte einzeln für Angehörige freigeben (nur nicht klinische Kategorien). */
export async function setFileSharedAction(residentFileId: string, shared: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const f = await db.residentFile.findFirst({ where: { id: residentFileId, file: { orgId: ctx.org.id } }, include: { resident: { include: { unit: true } } } })
    if (!f || !ctx.unitIds.includes(f.resident.unitId)) return { ok: false, error: 'common.notFound' }
    assertFamily(ctx, f.resident.unitId, f.resident.unit.locationId, 'portal.manage')
    if (shared && !isShareableFileCategory(f.category)) return { ok: false, error: 'portal.errors.fileClinical' }
    await db.residentFile.update({ where: { id: f.id }, data: shared ? { portalShared: true, portalSharedAt: new Date(), portalSharedById: ctx.user.id } : { portalShared: false, portalSharedAt: null, portalSharedById: null } })
    await audit(ctx, { action: shared ? 'portal.file.share' : 'portal.file.unshare', entityType: 'ResidentFile', entityId: f.id, before: { portalShared: f.portalShared }, after: { portalShared: shared }, context: { residentId: f.residentId } })
    refresh()
    return { ok: true, message: shared ? 'portal.team.fileShared' : 'portal.team.fileUnshared' }
  })
}

/** Standardfreigaben und Besuchsregeln (Organization.settings.portal), nur Konfiguration. */
export async function savePortalSettingsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    const before = portalSettings(ctx.org.settings)
    const next = portalSettings({ portal: { defaultGrants: normalizeGrants(form.getAll('defaultGrants')), visitLeadHours: fd(form, 'visitLeadHours'), visitMaxDays: fd(form, 'visitMaxDays') } })
    const fresh = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const settings = { ...((fresh.settings && typeof fresh.settings === 'object' && !Array.isArray(fresh.settings) ? fresh.settings : {}) as Record<string, unknown>), portal: next }
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: settings as object } })
    await audit(ctx, { action: 'portal.settings', entityType: 'Organization', entityId: ctx.org.id, before, after: next })
    refresh()
    return { ok: true, message: 'common.saved' }
  })
}
