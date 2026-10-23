'use server'

import { refresh } from 'next/cache'
import { mergeEdit, parseBase } from '@/lib/merge-check'
import { conflictMessage } from '@/lib/merge-server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { assertCan, getCtx } from '@/lib/context'
import { fd, fdBool, run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { saveUpload, UploadError } from '@/lib/files'
import { notifyT } from '@/lib/notify-t'
import { aiDraft, AiUnavailable } from '@/lib/ai'
import { aiConfigured } from '@/lib/env'
import { ackAudience, DOC_CATEGORIES, loadDoc, queryTerms, scoreDoc } from '@/lib/docs'
import { parseDateKey } from '@/lib/time'
import { ackSettings } from '@/lib/acks'
import { parseAudience } from '@/lib/audience'

const tagsOf = (s: string) => [...new Set(s.split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 20)
const dateOf = (s: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : null)

const MetaSchema = z.object({
  title: z.string().min(2, 'docs.errors.title').max(200),
  category: z.enum(DOC_CATEGORIES, { message: 'docs.errors.category' }),
})
const VersionSchema = z.object({
  version: z.string().regex(/^[\w.\-]{1,20}$/, 'docs.errors.version'),
  body: z.string().min(1, 'docs.errors.body').max(200_000),
})

async function maybeUpload(form: FormData) {
  const ctx = await getCtx()
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return null
  try {
    return (await saveUpload(ctx, file, 'document', false)).id
  } catch (e) {
    if (e instanceof UploadError) throw new UploadFail('docs.errors.upload_' + e.message)
    throw e
  }
}
class UploadFail extends Error {}
const uploadGuard = async <T,>(fn: () => Promise<ActionResult<T> | void>) =>
  run<T>(async () => {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof UploadFail) return { ok: false, error: e.message, field: 'file' }
      throw e
    }
  })

export async function createDocument(form: FormData) {
  return uploadGuard<{ id: string }>(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'docs.manage')
    const meta = MetaSchema.parse({ title: fd(form, 'title'), category: fd(form, 'category') })
    const ver = VersionSchema.parse({ version: fd(form, 'version') || '1.0', body: fd(form, 'body') })
    const fileId = await maybeUpload(form)
    const doc = await db.document.create({
      data: {
        orgId: ctx.org.id, title: meta.title, category: meta.category, tags: tagsOf(fd(form, 'tags')), status: 'draft',
        ownerId: ctx.user.id, requireAck: fdBool(form, 'requireAck'), validFrom: dateOf(fd(form, 'validFrom')), validUntil: dateOf(fd(form, 'validUntil')),
        audienceRoles: await parseAudience(ctx.org.id, form.getAll('audienceRoles')),
        versions: { create: { version: ver.version, body: ver.body, fileId, changeNote: fd(form, 'changeNote') || null, authorId: ctx.user.id } },
      },
    })
    await audit(ctx, { action: 'document.create', entityType: 'Document', entityId: doc.id, after: { title: doc.title, category: doc.category, version: ver.version } })
    return { ok: true, data: { id: doc.id } }
  })
}

export async function updateDocumentMeta(form: FormData) {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'docs.manage')
    const doc = await loadDoc(ctx, fd(form, 'id'))
    if (!doc) return { ok: false, error: 'common.notFound' }
    const meta = MetaSchema.parse({ title: fd(form, 'title'), category: fd(form, 'category') })
    const ownerId = fd(form, 'ownerId')
    const owner = ownerId ? await db.user.findFirst({ where: { id: ownerId, orgId: ctx.org.id } }) : null
    const data = {
      title: meta.title, category: meta.category, tags: tagsOf(fd(form, 'tags')), requireAck: fdBool(form, 'requireAck'),
      validFrom: dateOf(fd(form, 'validFrom')), validUntil: dateOf(fd(form, 'validUntil')), ownerId: owner?.id ?? doc.ownerId,
      audienceRoles: await parseAudience(ctx.org.id, form.getAll('audienceRoles')),
    }
    if (data.validFrom && data.validUntil && data.validUntil < data.validFrom) return { ok: false, error: 'docs.errors.validRange', field: 'validUntil' }
    await db.document.update({ where: { id: doc.id }, data })
    await audit(ctx, { action: 'document.update', entityType: 'Document', entityId: doc.id, before: { title: doc.title, category: doc.category, tags: doc.tags, requireAck: doc.requireAck, validFrom: doc.validFrom, validUntil: doc.validUntil, ownerId: doc.ownerId, audienceRoles: doc.audienceRoles }, after: data })
    refresh()
  })
}

export async function createVersion(form: FormData) {
  return uploadGuard(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'docs.manage')
    const doc = await loadDoc(ctx, fd(form, 'documentId'))
    if (!doc) return { ok: false, error: 'common.notFound' }
    if (doc.versions.some((v) => !v.approvedAt)) return { ok: false, error: 'docs.errors.draftExists' }
    const ver = VersionSchema.parse({ version: fd(form, 'version'), body: fd(form, 'body') })
    if (doc.versions.some((v) => v.version === ver.version)) return { ok: false, error: 'docs.errors.versionTaken', field: 'version' }
    const changeNote = fd(form, 'changeNote')
    if (!changeNote) return { ok: false, error: 'docs.errors.changeNote', field: 'changeNote' }
    const prev = doc.versions.find((v) => v.version === doc.currentVersion)
    const fileId = (await maybeUpload(form)) ?? (fdBool(form, 'keepFile') ? prev?.fileId ?? null : null)
    const v = await db.documentVersion.create({
      data: { documentId: doc.id, version: ver.version, body: ver.body, fileId, changeNote, critical: fdBool(form, 'critical'), authorId: ctx.user.id },
    })
    await audit(ctx, { action: 'document.version.create', entityType: 'DocumentVersion', entityId: v.id, after: { documentId: doc.id, version: v.version, critical: v.critical, changeNote } })
    refresh()
  })
}

const DRAFT_FIELDS = ['version', 'body', 'changeNote', 'critical'] as const

export async function updateDraft(form: FormData) {
  return uploadGuard(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'docs.manage')
    const v = await db.documentVersion.findFirst({ where: { id: fd(form, 'versionId'), document: { orgId: ctx.org.id } }, include: { document: { include: { versions: true } } } })
    if (!v) return { ok: false, error: 'common.notFound' }
    if (v.approvedAt) return { ok: false, error: 'docs.errors.approvedImmutable' }
    const ver = VersionSchema.parse({ version: fd(form, 'version'), body: fd(form, 'body') })
    if (v.document.versions.some((x) => x.id !== v.id && x.version === ver.version)) return { ok: false, error: 'docs.errors.versionTaken', field: 'version' }
    const changeNote = fd(form, 'changeNote')
    if (!changeNote && v.document.currentVersion) return { ok: false, error: 'docs.errors.changeNote', field: 'changeNote' }
    // Konflikterkennung (PRD §32): zwei Personen am selben Entwurf – nur eigene Änderungen übernehmen, gleiches Feld → Hinweis
    const mine = { version: ver.version, body: ver.body, changeNote: changeNote || null, critical: fdBool(form, 'critical') }
    const m = mergeEdit(parseBase(fd(form, 'base')), v as unknown as Record<string, unknown>, mine, DRAFT_FIELDS)
    if (m.conflicts.length) {
      refresh()
      return { ok: false, error: await conflictMessage(ctx, { entityType: 'DocumentVersion', entityId: v.id, actions: ['document.version.update', 'document.version.create'], fields: m.conflicts.map((k) => ctx.t('docs.conflict.' + k)) }), field: m.conflicts[0] === 'body' ? 'body' : m.conflicts[0] }
    }
    const uploaded = await maybeUpload(form)
    const fileId = uploaded ?? (fdBool(form, 'removeFile') ? null : v.fileId)
    const data = { ...(m.data as typeof mine), fileId }
    // Bedingtes Update: wurde der Entwurf seit dem Laden geändert (gleichzeitig), gewinnt nicht der Letzte stillschweigend
    const upd = await db.documentVersion.updateMany({ where: { id: v.id, approvedAt: null, version: v.version, body: v.body, changeNote: v.changeNote, critical: v.critical }, data })
    if (!upd.count) { refresh(); return { ok: false, error: 'docs.conflict.retry' } }
    await audit(ctx, { action: 'document.version.update', entityType: 'DocumentVersion', entityId: v.id, before: { version: v.version, changeNote: v.changeNote, critical: v.critical, bodyLength: v.body.length }, after: { ...data, body: undefined, bodyLength: data.body.length } })
    refresh()
  })
}

async function versionFor(versionId: string) {
  const ctx = await getCtx()
  const v = await db.documentVersion.findFirst({ where: { id: versionId, document: { orgId: ctx.org.id } }, include: { document: true } })
  return { ctx, v }
}

export async function submitVersion(versionId: string) {
  return run(async () => {
    const { ctx, v } = await versionFor(versionId)
    assertCan(ctx, 'docs.manage')
    if (!v || v.approvedAt) return { ok: false, error: 'common.notFound' }
    await db.documentVersion.update({ where: { id: v.id }, data: { submittedAt: new Date() } })
    if (!v.document.currentVersion) await db.document.update({ where: { id: v.documentId }, data: { status: 'review' } })
    await audit(ctx, { action: 'document.version.submit', entityType: 'DocumentVersion', entityId: v.id, after: { version: v.version } })
    const approvers = (await db.roleAssignment.findMany({ where: { role: { orgId: ctx.org.id, permissions: { has: 'docs.approve' } }, user: { active: true } }, select: { userId: true } })).map((r) => r.userId).filter((id) => id !== ctx.user.id)
    await notifyT({ orgId: ctx.org.id, userIds: approvers, priority: 'action', kind: 'document.review', titleKey: 'docs.notify.reviewTitle', vars: { title: v.document.title, version: v.version }, href: `/docs/${v.documentId}`, groupKey: `doc-review:${v.id}` })
    refresh()
  })
}

export async function returnToDraft(versionId: string) {
  return run(async () => {
    const { ctx, v } = await versionFor(versionId)
    assertCan(ctx, 'docs.approve')
    if (!v || v.approvedAt) return { ok: false, error: 'common.notFound' }
    await db.documentVersion.update({ where: { id: v.id }, data: { submittedAt: null } })
    if (!v.document.currentVersion) await db.document.update({ where: { id: v.documentId }, data: { status: 'draft' } })
    await audit(ctx, { action: 'document.version.return', entityType: 'DocumentVersion', entityId: v.id, after: { version: v.version } })
    refresh()
  })
}

export async function deleteDraft(versionId: string) {
  return run(async () => {
    const { ctx, v } = await versionFor(versionId)
    assertCan(ctx, 'docs.manage')
    if (!v || v.approvedAt) return { ok: false, error: 'common.notFound' }
    if (!v.document.currentVersion) return { ok: false, error: 'docs.errors.onlyVersion' }
    await db.documentVersion.delete({ where: { id: v.id } })
    await audit(ctx, { action: 'document.version.delete', entityType: 'DocumentVersion', entityId: v.id, before: { version: v.version, documentId: v.documentId } })
    refresh()
  })
}

export async function approveVersion(versionId: string) {
  return run(async () => {
    const { ctx, v } = await versionFor(versionId)
    assertCan(ctx, 'docs.approve')
    if (!v || v.approvedAt) return { ok: false, error: 'common.notFound' }
    const doc = v.document
    const prevVersion = doc.currentVersion
    const now = new Date()
    // Admin → Bestätigungen: ohne "erneute Kenntnisnahme" gelten Bestätigungen auch bei kritischen Versionen weiter.
    const reAck = v.critical && ackSettings(ctx.org.settings).criticalDocsReAck
    await db.$transaction(async (tx) => {
      await tx.documentVersion.update({ where: { id: v.id }, data: { approvedAt: now, approvedById: ctx.user.id, submittedAt: v.submittedAt ?? now } })
      await tx.document.update({ where: { id: doc.id }, data: { status: 'approved', currentVersion: v.version, validFrom: doc.validFrom && doc.validFrom > now ? doc.validFrom : now } })
      // Nicht-kritische Änderung: bestehende Kenntnisnahmen gelten weiter.
      if (prevVersion && !reAck) {
        const acks = await tx.acknowledgement.findMany({ where: { subjectType: 'document', subjectId: doc.id, version: prevVersion }, select: { userId: true } })
        if (acks.length) await tx.acknowledgement.createMany({ data: acks.map((a) => ({ userId: a.userId, subjectType: 'document', subjectId: doc.id, version: v.version, at: now })), skipDuplicates: true })
      }
      await audit(ctx, { action: 'document.approve', entityType: 'Document', entityId: doc.id, before: { currentVersion: prevVersion, status: doc.status }, after: { currentVersion: v.version, status: 'approved', critical: v.critical } }, tx)
    })
    const audience = (await ackAudience(ctx.org.id, doc.audienceRoles)).filter((id) => id !== ctx.user.id)
    const needsAck = doc.requireAck && (!prevVersion || reAck)
    await notifyT({
      orgId: ctx.org.id, userIds: audience, priority: needsAck ? 'action' : 'info', kind: needsAck ? 'ack' : 'document.published',
      titleKey: needsAck ? 'docs.notify.ackTitle' : 'docs.notify.publishedTitle', bodyKey: v.changeNote ? 'docs.notify.changeNote' : undefined,
      vars: { title: doc.title, version: v.version, note: v.changeNote ?? '' }, href: `/docs/${doc.id}`, groupKey: `doc:${doc.id}`,
    })
    await emit({ orgId: ctx.org.id, type: 'document.published', actorId: ctx.user.id, payload: { documentId: doc.id, version: v.version, critical: v.critical, requireAck: doc.requireAck } })
    refresh()
  })
}

export async function archiveDocument(id: string, restore = false) {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'docs.approve')
    const doc = await loadDoc(ctx, id)
    if (!doc) return { ok: false, error: 'common.notFound' }
    const status = restore ? (doc.currentVersion ? 'approved' : 'draft') : 'archived'
    await db.document.update({ where: { id }, data: { status } })
    await audit(ctx, { action: restore ? 'document.restore' : 'document.archive', entityType: 'Document', entityId: id, before: { status: doc.status }, after: { status } })
    refresh()
  })
}

export async function acknowledgeDocument(id: string) {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'docs.read')
    const doc = await loadDoc(ctx, id)
    if (!doc || doc.status !== 'approved' || !doc.currentVersion) return { ok: false, error: 'common.notFound' }
    await db.acknowledgement.upsert({
      where: { userId_subjectType_subjectId_version: { userId: ctx.user.id, subjectType: 'document', subjectId: id, version: doc.currentVersion } },
      create: { userId: ctx.user.id, subjectType: 'document', subjectId: id, version: doc.currentVersion },
      update: {},
    })
    await db.notification.updateMany({ where: { userId: ctx.user.id, readAt: null, OR: [{ groupKey: `doc:${id}` }, { groupKey: `doc-ack:${id}` }] }, data: { readAt: new Date() } })
    await audit(ctx, { action: 'document.acknowledge', entityType: 'Document', entityId: id, after: { version: doc.currentVersion } })
    refresh()
  })
}

export async function remindAck(id: string) {
  return run<{ n: number }>(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'docs.manage')
    const doc = await loadDoc(ctx, id)
    if (!doc || !doc.requireAck || !doc.currentVersion) return { ok: false, error: 'common.notFound' }
    const [audience, acks] = await Promise.all([
      ackAudience(ctx.org.id, doc.audienceRoles),
      db.acknowledgement.findMany({ where: { subjectType: 'document', subjectId: id, version: doc.currentVersion }, select: { userId: true } }),
    ])
    const done = new Set(acks.map((a) => a.userId))
    const missing = audience.filter((u) => !done.has(u))
    await notifyT({ orgId: ctx.org.id, userIds: missing, priority: 'action', kind: 'ack', titleKey: 'docs.notify.reminderTitle', vars: { title: doc.title, version: doc.currentVersion }, href: `/docs/${id}`, groupKey: `doc-ack:${id}` })
    await audit(ctx, { action: 'document.ack.remind', entityType: 'Document', entityId: id, after: { recipients: missing.length } })
    return { ok: true, data: { n: missing.length }, message: ctx.t('docs.ack.reminded', { n: missing.length }) }
  })
}

export type AssistantAnswer = { text: string; aiId: string; sources: { n: number; id: string; title: string; version: string }[] }

/** Search Assistant (PRD §23.1): beantwortet eine Frage ausschliesslich aus freigegebenen Dokumenten. */
export async function askAssistant(q: string) {
  return run<AssistantAnswer>(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'docs.read')
    const question = q.trim().slice(0, 500)
    if (!question || !aiConfigured()) return { ok: false, error: 'common.ai.unavailable' }
    const docs = await db.document.findMany({ where: { orgId: ctx.org.id, status: 'approved', currentVersion: { not: null } }, include: { versions: { where: { approvedAt: { not: null } } } } })
    const terms = queryTerms(question)
    const ranked = docs
      .map((d) => {
        const body = d.versions.find((v) => v.version === d.currentVersion)?.body ?? ''
        return { d, body, score: scoreDoc({ ...d, body }, terms, ctx.t('docs.cat.' + d.category)) }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    if (!ranked.length) return { ok: false, error: 'docs.assistant.noSource' }
    const sources = ranked.map((r, i) => ({ n: i + 1, id: r.d.id, title: r.d.title, version: r.d.currentVersion ?? '' }))
    const input = `Frage: ${question}\n\n` + ranked.map((r, i) => `[${i + 1}] ${r.d.title} (Version ${r.d.currentVersion})\n${r.body.slice(0, 6000)}`).join('\n\n---\n\n')
    try {
      const res = await aiDraft(ctx, 'search', 'Beantworte die Frage ausschliesslich anhand der nummerierten Dokumente. Gib die relevanten Schritte knapp wieder und nenne die Quelle als [Nummer]. Wenn die Dokumente die Frage nicht beantworten, sage das in einem Satz.', input, 800)
      await audit(ctx, { action: 'ai.search', entityType: 'AiInteraction', entityId: res.id, context: { sources: sources.map((s) => s.id) } })
      return { ok: true, data: { text: res.text, aiId: res.id, sources } }
    } catch (e) {
      if (e instanceof AiUnavailable) return { ok: false, error: 'common.ai.unavailable' }
      throw e
    }
  })
}
