'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, assertCan, ForbiddenError, type Ctx } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify } from '@/lib/notify'
import { saveUpload, UploadError } from '@/lib/files'
import { atTime, parseDateKey } from '@/lib/time'
import { canModerate, canPostTo, channelAudience, channelVisible, myRoleKeys, postVisible } from './lib'
import { parseAudience } from '@/lib/audience'

const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })

/** Anhänge speichern (nicht klinisch). Fehlende Dateiablage wird verständlich gemeldet. */
async function uploadAll(ctx: Ctx, files: File[], clinical = false) {
  const ids: string[] = []
  for (const f of files) {
    if (!f || typeof f === 'string' || f.size === 0) continue
    try {
      ids.push((await saveUpload(ctx, f, 'attachment', clinical)).id)
    } catch (e) {
      if (e instanceof UploadError) return { error: e.message === 'storage_not_configured' ? 'team.errors.storage' : e.message === 'too_large' ? 'team.errors.tooLarge' : e.message === 'type' ? 'team.errors.fileType' : 'team.errors.upload' }
      throw e
    }
  }
  return { ids }
}

async function loadPost(ctx: Ctx, postId: string) {
  const post = await db.post.findFirst({ where: { id: postId, channel: { orgId: ctx.org.id } }, include: { channel: true } })
  if (!post || !postVisible(ctx, post, await myRoleKeys(ctx.user.id))) return null
  return post
}

export async function publishPostAction(form: FormData): Promise<ActionResult> {
  const ctx = await getCtx()
  let postId = ''
  const r = await run(async () => {
    assertCan(ctx, 'team.post')
    const title = fd(form, 'title')
    const body = fd(form, 'body')
    const channelId = fd(form, 'channelId')
    if (!title) return err('team.errors.title', 'title')
    if (!body) return err('team.errors.body', 'body')
    const channel = channelId ? await db.channel.findFirst({ where: { id: channelId, orgId: ctx.org.id } }) : null
    if (!channel) return err('team.errors.channel', 'channelId')
    if (!canPostTo(ctx, channel, await myRoleKeys(ctx.user.id))) return err(channel.postRoles.length ? 'team.errors.channelRole' : 'common.notAllowed', 'channelId')

    const eventDate = fd(form, 'eventDate')
    const eventTime = fd(form, 'eventTime') || '00:00'
    const eventAt = eventDate ? atTime(parseDateKey(eventDate), eventTime) : null
    const expiresDate = fd(form, 'expiresAt')
    const expiresAt = expiresDate ? atTime(parseDateKey(expiresDate), '23:59') : null
    if ((eventAt && Number.isNaN(eventAt.getTime())) || (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()))) return err('team.errors.date', expiresAt ? 'expiresAt' : 'eventDate')
    const requireAck = fdBool(form, 'requireAck')
    const pinned = fdBool(form, 'pinned') && canModerate(ctx, channel)
    const audienceRoles = await parseAudience(ctx.org.id, form.getAll('audienceRoles'))

    const up = await uploadAll(ctx, form.getAll('files') as File[])
    if ('error' in up) return err(up.error as string, 'files')

    const post = await db.post.create({
      data: {
        channelId: channel.id, authorId: ctx.user.id, title: title.slice(0, 200), body,
        important: fdBool(form, 'important') || requireAck, requireAck, pinned,
        eventAt, eventPlace: fd(form, 'eventPlace') || null, expiresAt, fileIds: up.ids, audienceRoles,
      },
    })
    postId = post.id
    await audit(ctx, { action: 'post.publish', entityType: 'Post', entityId: post.id, after: { channelId: channel.id, title: post.title, requireAck, pinned, important: post.important, audienceRoles } })
    const audience = (await channelAudience(ctx.org.id, channel, audienceRoles)).map((u) => u.id).filter((id) => id !== ctx.user.id)
    await notify({
      orgId: ctx.org.id, userIds: audience, priority: requireAck ? 'action' : 'info', kind: 'post',
      title: ctx.t('team.form.notifyTitle', { channel: channel.name, title: post.title }), href: `/team/post/${post.id}`,
      groupKey: requireAck ? `post-ack:${post.id}` : `team-channel:${channel.id}`,
    })
    await emit({ orgId: ctx.org.id, type: 'post.published', unitId: channel.unitId, actorId: ctx.user.id, payload: { postId: post.id, channelId: channel.id, requireAck } })
  })
  if (r.ok && postId) redirect(`/team/post/${postId}`)
  return r
}

export async function ackPostAction(postId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'team.read')
    const post = await loadPost(ctx, postId)
    if (!post || !post.requireAck) return err('team.post.notFound')
    await db.acknowledgement.upsert({
      where: { userId_subjectType_subjectId_version: { userId: ctx.user.id, subjectType: 'post', subjectId: post.id, version: '' } },
      create: { userId: ctx.user.id, subjectType: 'post', subjectId: post.id },
      update: {},
    })
    await db.notification.updateMany({ where: { userId: ctx.user.id, groupKey: `post-ack:${post.id}`, readAt: null }, data: { readAt: new Date() } })
    await audit(ctx, { action: 'post.acknowledge', entityType: 'Post', entityId: post.id })
    await emit({ orgId: ctx.org.id, type: 'post.published', unitId: post.channel.unitId, actorId: ctx.user.id, userIds: [post.authorId], payload: { postId: post.id, ack: true } })
    refresh()
    return { ok: true, message: 'team.ack.toast' }
  })
}

export async function remindAckAction(postId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const post = await loadPost(ctx, postId)
    if (!post || !post.requireAck) return err('team.post.notFound')
    if (post.authorId !== ctx.user.id && !canModerate(ctx, post.channel)) throw new ForbiddenError('team.moderate')
    const audience = await channelAudience(ctx.org.id, post.channel, post.audienceRoles)
    const acks = await db.acknowledgement.findMany({ where: { subjectType: 'post', subjectId: post.id }, select: { userId: true } })
    const done = new Set(acks.map((a) => a.userId))
    const missing = audience.filter((u) => !done.has(u.id) && u.id !== post.authorId).map((u) => u.id)
    if (!missing.length) return { ok: true, message: ctx.t('team.ack.allDone') }
    await notify({ orgId: ctx.org.id, userIds: missing, priority: 'action', kind: 'post', title: ctx.t('team.ack.reminderTitle', { title: post.title }), href: `/team/post/${post.id}`, groupKey: `post-ack:${post.id}` })
    await audit(ctx, { action: 'post.remind', entityType: 'Post', entityId: post.id, context: { recipients: missing.length } })
    return { ok: true, message: ctx.t('team.ack.reminded', { n: missing.length }) }
  })
}

export async function commentAction(postId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'team.read')
    const body = fd(form, 'body')
    if (!body) return err('team.errors.comment', 'body')
    const post = await loadPost(ctx, postId)
    if (!post) return err('team.post.notFound')
    const c = await db.postComment.create({ data: { postId: post.id, authorId: ctx.user.id, body: body.slice(0, 4000) } })
    await audit(ctx, { action: 'post.comment', entityType: 'PostComment', entityId: c.id, context: { postId: post.id } })
    if (post.authorId !== ctx.user.id)
      await notify({ orgId: ctx.org.id, userIds: [post.authorId], priority: 'social', kind: 'post', title: ctx.t('team.comments.notifyTitle', { name: `${ctx.user.firstName} ${ctx.user.lastName}`, title: post.title }), href: `/team/post/${post.id}`, groupKey: `post-comment:${post.id}` })
    await emit({ orgId: ctx.org.id, type: 'post.published', unitId: post.channel.unitId, actorId: ctx.user.id, payload: { postId: post.id, comment: true } })
    refresh()
    return { ok: true, message: 'team.comments.saved' }
  })
}

export async function pinPostAction(postId: string, pinned: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const post = await loadPost(ctx, postId)
    if (!post) return err('team.post.notFound')
    if (!canModerate(ctx, post.channel)) throw new ForbiddenError('team.moderate')
    await db.post.update({ where: { id: post.id }, data: { pinned } })
    await audit(ctx, { action: pinned ? 'post.pin' : 'post.unpin', entityType: 'Post', entityId: post.id, before: { pinned: post.pinned }, after: { pinned } })
    await emit({ orgId: ctx.org.id, type: 'post.published', unitId: post.channel.unitId, actorId: ctx.user.id, payload: { postId: post.id, pinned } })
    refresh()
    return { ok: true, message: pinned ? 'team.post.pinned' : 'team.post.unpinned' }
  })
}

/** Entfernen = sofort ablaufen lassen (Soft Delete, bleibt im Audit nachvollziehbar). */
export async function deletePostAction(postId: string): Promise<ActionResult> {
  const ctx = await getCtx()
  const r = await run(async () => {
    const post = await loadPost(ctx, postId)
    if (!post) return err('team.post.notFound')
    if (post.authorId !== ctx.user.id && !canModerate(ctx, post.channel)) throw new ForbiddenError('team.moderate')
    const now = new Date()
    await db.post.update({ where: { id: post.id }, data: { expiresAt: now, pinned: false } })
    await audit(ctx, { action: 'post.delete', entityType: 'Post', entityId: post.id, before: { expiresAt: post.expiresAt, title: post.title }, after: { expiresAt: now } })
    await emit({ orgId: ctx.org.id, type: 'post.published', unitId: post.channel.unitId, actorId: ctx.user.id, payload: { postId: post.id, deleted: true } })
  })
  if (r.ok) redirect('/team')
  return r
}

export async function archiveChannelAction(channelId: string, archived: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const ch = await db.channel.findFirst({ where: { id: channelId, orgId: ctx.org.id } })
    if (!ch || !channelVisible(ctx, ch)) return err('common.notFound')
    if (!canModerate(ctx, ch)) throw new ForbiddenError('team.moderate')
    await db.channel.update({ where: { id: ch.id }, data: { archived } })
    await audit(ctx, { action: archived ? 'channel.archive' : 'channel.restore', entityType: 'Channel', entityId: ch.id, before: { archived: ch.archived }, after: { archived } })
    await emit({ orgId: ctx.org.id, type: 'post.published', unitId: ch.unitId, actorId: ctx.user.id, payload: { channelId: ch.id, archived } })
    refresh()
    return { ok: true, message: archived ? 'team.side.archivedMsg' : 'team.side.restoredMsg' }
  })
}
