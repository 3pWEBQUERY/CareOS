'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'

const KINDS = ['company', 'location', 'unit', 'care', 'admin', 'events', 'offers', 'custom'] as const

export async function saveChannelAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    const id = fd(form, 'id')
    const name = fd(form, 'name').slice(0, 80)
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    const kind = z.enum(KINDS).catch('custom').parse(fd(form, 'kind'))
    const [scopeKind, scopeId] = fd(form, 'scope').split(':')
    let locationId: string | null = null
    let unitId: string | null = null
    if (scopeKind === 'loc') {
      if (!(await db.location.findFirst({ where: { id: scopeId, orgId: ctx.org.id } }))) return { ok: false, error: 'admin.structure.pickLocation', field: 'scope' }
      locationId = scopeId
    } else if (scopeKind === 'unit') {
      const u = await db.unit.findFirst({ where: { id: scopeId, orgId: ctx.org.id } })
      if (!u) return { ok: false, error: 'admin.structure.pickUnit', field: 'scope' }
      unitId = u.id
      locationId = u.locationId
    }
    const roleKeys = new Set((await db.role.findMany({ where: { orgId: ctx.org.id }, select: { key: true } })).map((r) => r.key))
    const postRoles = form.getAll('postRoles').map(String).filter((k) => roleKeys.has(k))
    const data = { name, kind, description: fd(form, 'description').slice(0, 300) || null, locationId, unitId, postRoles, archived: fdBool(form, 'archived') }
    if (id) {
      const before = await db.channel.findFirst({ where: { id, orgId: ctx.org.id } })
      if (!before) return { ok: false, error: 'common.notFound' }
      await db.channel.update({ where: { id }, data })
      await audit(ctx, { action: 'admin.channel.update', entityType: 'Channel', entityId: id, before: { name: before.name, kind: before.kind, description: before.description, locationId: before.locationId, unitId: before.unitId, postRoles: before.postRoles, archived: before.archived }, after: data })
    } else {
      const ch = await db.channel.create({ data: { ...data, orgId: ctx.org.id } })
      await audit(ctx, { action: 'admin.channel.create', entityType: 'Channel', entityId: ch.id, after: data })
    }
    refresh()
  })
}

export async function deleteChannelAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    const ch = await db.channel.findFirst({ where: { id, orgId: ctx.org.id }, include: { _count: { select: { posts: true } } } })
    if (!ch) return { ok: false, error: 'common.notFound' }
    if (ch._count.posts) return { ok: false, error: 'admin.channels.hasPosts' }
    await db.channel.delete({ where: { id } })
    await audit(ctx, { action: 'admin.channel.delete', entityType: 'Channel', entityId: id, before: { name: ch.name, kind: ch.kind } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}
