'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { ALL_PERMISSIONS } from '@/lib/permissions'
import { guardLastAdmin, LastAdminError } from '@/lib/admin'
import { slugKey } from '@/lib/admin-shared'

async function admin() {
  const ctx = await getCtx()
  assertCan(ctx, 'admin.roles')
  return ctx
}

export async function createRoleAction(form: FormData): Promise<ActionResult> {
  let id = ''
  const r = await run<undefined>(async () => {
    const ctx = await admin()
    const name = fd(form, 'name').slice(0, 80)
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    const description = fd(form, 'description').slice(0, 300) || null
    const from = fd(form, 'copyFrom') ? await db.role.findFirst({ where: { id: fd(form, 'copyFrom'), orgId: ctx.org.id } }) : null
    const base = slugKey(name) || 'role'
    let key = base
    for (let i = 2; await db.role.findUnique({ where: { orgId_key: { orgId: ctx.org.id, key } } }); i++) key = `${base}_${i}`
    const role = await db.role.create({ data: { orgId: ctx.org.id, key, name, description, permissions: from?.permissions ?? [], system: false } })
    await audit(ctx, { action: 'admin.role.create', entityType: 'Role', entityId: role.id, after: { key, name, description, permissions: role.permissions, copiedFrom: from?.key ?? null } })
    id = role.id
  })
  if (r.ok && id) redirect(`/admin/roles/${id}`)
  return r
}

export async function updateRoleAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const before = await db.role.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!before) return { ok: false, error: 'common.notFound' }
    const name = fd(form, 'name').slice(0, 80)
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    const description = fd(form, 'description').slice(0, 300) || null
    const wanted = new Set(form.getAll('perm').map(String))
    const permissions = ALL_PERMISSIONS.filter((p) => wanted.has(p))
    try {
      await guardLastAdmin(ctx.org.id, (tx) => tx.role.update({ where: { id }, data: { name, description, permissions } }))
    } catch (e) {
      if (e instanceof LastAdminError) return { ok: false, error: 'admin.errors.lastAdmin' }
      throw e
    }
    const added = permissions.filter((p) => !before.permissions.includes(p))
    const removed = before.permissions.filter((p) => !permissions.includes(p as never))
    await audit(ctx, {
      action: 'admin.role.update', entityType: 'Role', entityId: id,
      before: { name: before.name, description: before.description, permissions: before.permissions },
      after: { name, description, permissions },
      context: { added, removed },
    })
    refresh()
  })
}

export async function deleteRoleAction(id: string): Promise<ActionResult> {
  const r = await run<undefined>(async () => {
    const ctx = await admin()
    const role = await db.role.findFirst({ where: { id, orgId: ctx.org.id }, include: { assignments: true } })
    if (!role) return { ok: false, error: 'common.notFound' }
    if (role.system) return { ok: false, error: 'admin.roles.systemNoDelete' }
    try {
      await guardLastAdmin(ctx.org.id, (tx) => tx.role.delete({ where: { id } }))
    } catch (e) {
      if (e instanceof LastAdminError) return { ok: false, error: 'admin.errors.lastAdmin' }
      throw e
    }
    await audit(ctx, { action: 'admin.role.delete', entityType: 'Role', entityId: id, before: { key: role.key, name: role.name, permissions: role.permissions, assignments: role.assignments.map((a) => ({ userId: a.userId, unitId: a.unitId, locationId: a.locationId })) } })
  })
  if (r.ok) redirect('/admin/roles')
  return r
}
