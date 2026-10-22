'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, assertCan, ForbiddenError, type Ctx } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify, usersWithPermission } from '@/lib/notify'
import { saveUpload, UploadError } from '@/lib/files'
import { REACTIONS } from './reactions'

const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })

/** Unterhaltung nur für Mitglieder; klinische nur mit chat.clinical (PRD §18). */
async function memberConversation(ctx: Ctx, conversationId: string) {
  assertCan(ctx, 'chat.use')
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, orgId: ctx.org.id, members: { some: { userId: ctx.user.id } } },
    include: { members: true },
  })
  if (!conv) throw new ForbiddenError('chat.use')
  if (conv.clinical && !ctx.can('chat.clinical')) throw new ForbiddenError('chat.clinical')
  return conv
}

async function signal(ctx: Ctx, conv: { id: string; members: { userId: string }[] }, extra: Record<string, unknown> = {}) {
  await emit({ orgId: ctx.org.id, type: 'message.created', actorId: ctx.user.id, userIds: conv.members.map((m) => m.userId), payload: { conversationId: conv.id, ...extra } })
}

export async function sendMessageAction(conversationId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const conv = await memberConversation(ctx, conversationId)
    const body = fd(form, 'body').replace(/\r\n?/g, '\n').slice(0, 8000)
    const files = (form.getAll('files') as File[]).filter((f) => f && typeof f !== 'string' && f.size > 0)
    if (!body && !files.length) return err('team.chat.errors.empty', 'body')

    const fileIds: string[] = []
    for (const f of files) {
      try {
        fileIds.push((await saveUpload(ctx, f, 'attachment', conv.clinical)).id)
      } catch (e) {
        if (e instanceof UploadError) return err(e.message === 'storage_not_configured' ? 'team.errors.storage' : e.message === 'too_large' ? 'team.errors.tooLarge' : e.message === 'type' ? 'team.errors.fileType' : 'team.errors.upload', 'files')
        throw e
      }
    }
    // Erwähnungen nur für Mitglieder, deren Name auch im Text steht.
    const memberIds = new Set(conv.members.map((m) => m.userId))
    const wanted = fd(form, 'mentions').split(',').filter((id) => id && memberIds.has(id) && id !== ctx.user.id)
    const users = wanted.length ? await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, firstName: true, lastName: true } }) : []
    const mentions = users.filter((u) => body.includes(`@${u.firstName} ${u.lastName}`)).map((u) => u.id)

    const now = new Date()
    const msg = await db.message.create({ data: { conversationId: conv.id, authorId: ctx.user.id, body, fileIds, mentions, createdAt: now } })
    await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: now } })
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: conv.id, userId: ctx.user.id } }, data: { lastReadAt: now } })
    if (conv.clinical) await audit(ctx, { action: 'message.create', entityType: 'Message', entityId: msg.id, after: { body, fileIds, mentions }, context: { conversationId: conv.id, clinical: true } })

    const author = `${ctx.user.firstName} ${ctx.user.lastName}`
    const href = `/chat?c=${conv.id}`
    if (conv.kind === 'direct') {
      // Direktnachricht: eine gebündelte Benachrichtigung je Unterhaltung (Erwähnungen inklusive).
      const others = conv.members.filter((m) => m.userId !== ctx.user.id && !m.muted).map((m) => m.userId)
      await notify({ orgId: ctx.org.id, userIds: others, priority: 'social', kind: 'chat', title: ctx.t('team.chat.messageNotify', { name: author }), body: conv.clinical ? undefined : (body || files.map((f) => f.name).join(', ')).slice(0, 120), href, groupKey: `chat:${conv.id}` })
    } else if (mentions.length) {
      await notify({ orgId: ctx.org.id, userIds: mentions, priority: 'social', kind: 'chat', title: ctx.t('team.chat.mentionNotify', { name: author, conv: conv.name ?? '' }), body: conv.clinical ? undefined : body.slice(0, 120), href, groupKey: `chat-mention:${conv.id}` })
    }
    await signal(ctx, conv, { messageId: msg.id })
    refresh()
  })
}

export async function editMessageAction(messageId: string, body: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const msg = await db.message.findUnique({ where: { id: messageId } })
    if (!msg || msg.deletedAt) return err('common.notFound')
    const conv = await memberConversation(ctx, msg.conversationId)
    if (msg.authorId !== ctx.user.id) throw new ForbiddenError('chat.use')
    const text = body.trim().slice(0, 8000)
    if (!text) return err('team.chat.errors.empty')
    await db.message.update({ where: { id: msg.id }, data: { body: text, editedAt: new Date() } })
    if (conv.clinical) await audit(ctx, { action: 'message.edit', entityType: 'Message', entityId: msg.id, before: { body: msg.body }, after: { body: text }, context: { conversationId: conv.id, clinical: true } })
    await signal(ctx, conv, { messageId: msg.id, edited: true })
    refresh()
  })
}

export async function deleteMessageAction(messageId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const msg = await db.message.findUnique({ where: { id: messageId } })
    if (!msg || msg.deletedAt) return err('common.notFound')
    const conv = await memberConversation(ctx, msg.conversationId)
    if (msg.authorId !== ctx.user.id) throw new ForbiddenError('chat.use')
    const now = new Date()
    await db.message.update({ where: { id: msg.id }, data: { deletedAt: now } })
    if (conv.clinical) await audit(ctx, { action: 'message.delete', entityType: 'Message', entityId: msg.id, before: { body: msg.body }, after: { deletedAt: now }, context: { conversationId: conv.id, clinical: true } })
    await signal(ctx, conv, { messageId: msg.id, deleted: true })
    refresh()
    return { ok: true, message: 'team.chat.deletedMsg' }
  })
}

export async function reactAction(messageId: string, key: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const r = REACTIONS.find((x) => x.key === key)
    if (!r) return err('common.genericError')
    const msg = await db.message.findUnique({ where: { id: messageId } })
    if (!msg || msg.deletedAt) return err('common.notFound')
    const conv = await memberConversation(ctx, msg.conversationId)
    const id = { messageId_userId_emoji: { messageId: msg.id, userId: ctx.user.id, emoji: r.symbol } }
    const existing = await db.messageReaction.findUnique({ where: id })
    if (existing) await db.messageReaction.delete({ where: id })
    else await db.messageReaction.create({ data: { messageId: msg.id, userId: ctx.user.id, emoji: r.symbol } })
    await signal(ctx, conv, { messageId: msg.id, reaction: true })
    refresh()
  })
}

export async function markReadAction(conversationId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const conv = await memberConversation(ctx, conversationId)
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: conv.id, userId: ctx.user.id } }, data: { lastReadAt: new Date() } })
    await db.notification.updateMany({ where: { userId: ctx.user.id, groupKey: { in: [`chat:${conv.id}`, `chat-mention:${conv.id}`] }, readAt: null }, data: { readAt: new Date() } })
    refresh()
  })
}

export async function muteAction(conversationId: string, muted: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const conv = await memberConversation(ctx, conversationId)
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: conv.id, userId: ctx.user.id } }, data: { muted } })
    refresh()
    return { ok: true, message: muted ? 'team.chat.mutedMsg' : 'team.chat.unmutedMsg' }
  })
}

export async function addMemberAction(conversationId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const conv = await memberConversation(ctx, conversationId)
    if (conv.kind === 'direct') return err('common.notAllowed')
    const userId = fd(form, 'userId')
    const u = userId ? await db.user.findFirst({ where: { id: userId, orgId: ctx.org.id, active: true } }) : null
    if (!u) return err('team.chat.errors.person', 'userId')
    if (conv.clinical && !(await usersWithPermission(ctx.org.id, 'chat.clinical')).includes(u.id)) return err('team.chat.errors.clinicalMember', 'userId')
    await db.conversationMember.upsert({ where: { conversationId_userId: { conversationId: conv.id, userId: u.id } }, create: { conversationId: conv.id, userId: u.id, lastReadAt: new Date(0) }, update: {} })
    if (conv.clinical) await audit(ctx, { action: 'conversation.member.add', entityType: 'Conversation', entityId: conv.id, after: { userId: u.id } })
    await signal({ ...ctx }, { id: conv.id, members: [...conv.members, { userId: u.id }] }, { member: true })
    refresh()
    return { ok: true, message: 'team.chat.memberAdded' }
  })
}

export async function leaveConversationAction(conversationId: string): Promise<ActionResult> {
  const ctx = await getCtx()
  const r = await run(async () => {
    const conv = await memberConversation(ctx, conversationId)
    if (conv.kind === 'direct') return err('common.notAllowed')
    await db.conversationMember.delete({ where: { conversationId_userId: { conversationId: conv.id, userId: ctx.user.id } } })
    if (conv.clinical) await audit(ctx, { action: 'conversation.member.leave', entityType: 'Conversation', entityId: conv.id, before: { userId: ctx.user.id } })
    await signal(ctx, conv, { member: true })
  })
  if (r.ok) redirect('/chat')
  return r
}

export async function createConversationAction(form: FormData): Promise<ActionResult> {
  const ctx = await getCtx()
  let id = ''
  const r = await run(async () => {
    assertCan(ctx, 'chat.use')
    const kind = fd(form, 'kind')
    const clinical = fdBool(form, 'clinical')
    if (clinical) assertCan(ctx, 'chat.clinical')
    const clinicalIds = clinical ? new Set(await usersWithPermission(ctx.org.id, 'chat.clinical')) : null

    let memberIds: string[] = []
    let name: string | null = null
    if (kind === 'direct') {
      const other = fd(form, 'userId')
      if (!other) return err('team.chat.errors.person', 'userId')
      memberIds = [other]
    } else if (kind === 'group') {
      name = fd(form, 'name').slice(0, 120)
      if (!name) return err('team.chat.errors.name', 'name')
      memberIds = form.getAll('members').map(String).filter(Boolean)
      if (!memberIds.length) return err('team.chat.errors.members', 'members')
    } else if (kind === 'team') {
      const team = await db.team.findFirst({ where: { id: fd(form, 'teamId'), orgId: ctx.org.id }, include: { members: true } })
      if (!team) return err('team.chat.errors.team', 'teamId')
      name = team.name
      memberIds = team.members.map((m) => m.userId)
    } else return err('common.genericError')

    const valid = await db.user.findMany({ where: { orgId: ctx.org.id, active: true, id: { in: memberIds } }, select: { id: true } })
    let ids = [...new Set([ctx.user.id, ...valid.map((v) => v.id)])]
    if (clinicalIds) ids = ids.filter((x) => clinicalIds.has(x))
    if (ids.length < 2) return err(clinical ? 'team.chat.errors.clinicalMember' : 'team.chat.errors.members', kind === 'direct' ? 'userId' : 'members')

    if (kind === 'direct') {
      const existing = await db.conversation.findFirst({
        where: { orgId: ctx.org.id, kind: 'direct', clinical, AND: ids.map((u) => ({ members: { some: { userId: u } } })) },
        include: { _count: { select: { members: true } } },
      })
      if (existing && existing._count.members === 2) {
        id = existing.id
        return
      }
    }
    const now = new Date()
    const conv = await db.conversation.create({
      data: { orgId: ctx.org.id, kind: kind as 'direct' | 'group' | 'team', name, clinical, createdById: ctx.user.id, lastMessageAt: now, members: { create: ids.map((u) => ({ userId: u, lastReadAt: now })) } },
    })
    id = conv.id
    await audit(ctx, { action: 'conversation.create', entityType: 'Conversation', entityId: conv.id, after: { kind, name, clinical, members: ids } })
    await emit({ orgId: ctx.org.id, type: 'message.created', actorId: ctx.user.id, userIds: ids, payload: { conversationId: conv.id, created: true } })
  })
  if (r.ok && id) redirect(`/chat?c=${id}`)
  return r
}
