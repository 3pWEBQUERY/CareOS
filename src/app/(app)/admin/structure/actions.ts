'use server'

import { refresh } from 'next/cache'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan, type Ctx } from '@/lib/context'
import { run, fd, fdNum, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { UNIT_KINDS } from '@/lib/admin-shared'

async function admin() {
  const ctx = await getCtx()
  assertCan(ctx, 'admin.org')
  return ctx
}
const unique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
async function unitInOrg(ctx: Ctx, id: string) {
  return db.unit.findFirst({ where: { id, orgId: ctx.org.id } })
}

// ───────── Standorte ─────────

export async function saveLocationAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const data = { name: fd(form, 'name').slice(0, 120), address: fd(form, 'address').slice(0, 200) || null, phone: fd(form, 'phone').slice(0, 40) || null }
    if (data.name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    if (id) {
      const before = await db.location.findFirst({ where: { id, orgId: ctx.org.id } })
      if (!before) return { ok: false, error: 'common.notFound' }
      await db.location.update({ where: { id }, data })
      await audit(ctx, { action: 'admin.location.update', entityType: 'Location', entityId: id, before, after: data })
    } else {
      const loc = await db.location.create({ data: { ...data, orgId: ctx.org.id } })
      await audit(ctx, { action: 'admin.location.create', entityType: 'Location', entityId: loc.id, after: data })
    }
    refresh()
  })
}

export async function deleteLocationAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const loc = await db.location.findFirst({ where: { id, orgId: ctx.org.id }, include: { _count: { select: { units: true } } } })
    if (!loc) return { ok: false, error: 'common.notFound' }
    if (loc._count.units) return { ok: false, error: 'admin.structure.locationHasUnits' }
    await db.location.delete({ where: { id } })
    await audit(ctx, { action: 'admin.location.delete', entityType: 'Location', entityId: id, before: { name: loc.name, address: loc.address } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}

// ───────── Bereiche ─────────

export async function saveUnitAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const locationId = fd(form, 'locationId')
    const kind = fd(form, 'kind')
    const data = { name: fd(form, 'name').slice(0, 120), shortName: fd(form, 'shortName').slice(0, 12) || null, kind: (UNIT_KINDS as readonly string[]).includes(kind) ? kind : 'ward', locationId, phone: fd(form, 'phone').slice(0, 40) || null }
    if (data.name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    if (!(await db.location.findFirst({ where: { id: locationId, orgId: ctx.org.id } }))) return { ok: false, error: 'admin.structure.pickLocation', field: 'locationId' }
    if (id) {
      const before = await unitInOrg(ctx, id)
      if (!before) return { ok: false, error: 'common.notFound' }
      await db.unit.update({ where: { id }, data })
      await audit(ctx, { action: 'admin.unit.update', entityType: 'Unit', entityId: id, before, after: data })
    } else {
      const u = await db.unit.create({ data: { ...data, orgId: ctx.org.id } })
      await audit(ctx, { action: 'admin.unit.create', entityType: 'Unit', entityId: u.id, after: data })
    }
    refresh()
  })
}

export async function deleteUnitAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const u = await db.unit.findFirst({ where: { id, orgId: ctx.org.id }, include: { _count: { select: { residents: true } } } })
    if (!u) return { ok: false, error: 'common.notFound' }
    if (u._count.residents) return { ok: false, error: 'admin.structure.unitHasResidents' }
    await db.unit.delete({ where: { id } })
    await audit(ctx, { action: 'admin.unit.delete', entityType: 'Unit', entityId: id, before: { name: u.name, locationId: u.locationId, kind: u.kind } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}

// ───────── Zimmer ─────────

export async function saveRoomAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const unitId = fd(form, 'unitId')
    const number = fd(form, 'number').slice(0, 12)
    const beds = fdNum(form, 'beds') ?? 1
    if (!number) return { ok: false, error: 'admin.structure.roomNumber', field: 'number' }
    if (!Number.isInteger(beds) || beds < 1 || beds > 8) return { ok: false, error: 'admin.structure.beds', field: 'beds' }
    if (!(await unitInOrg(ctx, unitId))) return { ok: false, error: 'admin.structure.pickUnit', field: 'unitId' }
    try {
      if (id) {
        const before = await db.room.findFirst({ where: { id, unit: { orgId: ctx.org.id } } })
        if (!before) return { ok: false, error: 'common.notFound' }
        await db.room.update({ where: { id }, data: { number, beds, unitId } })
        await audit(ctx, { action: 'admin.room.update', entityType: 'Room', entityId: id, before, after: { number, beds, unitId } })
      } else {
        const r = await db.room.create({ data: { number, beds, unitId } })
        await audit(ctx, { action: 'admin.room.create', entityType: 'Room', entityId: r.id, after: { number, beds, unitId } })
      }
    } catch (e) {
      if (unique(e)) return { ok: false, error: 'admin.structure.roomExists', field: 'number' }
      throw e
    }
    refresh()
  })
}

export async function deleteRoomAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const r = await db.room.findFirst({ where: { id, unit: { orgId: ctx.org.id } }, include: { _count: { select: { residents: { where: { status: { in: ['active', 'absent'] } } } } } } })
    if (!r) return { ok: false, error: 'common.notFound' }
    if (r._count.residents) return { ok: false, error: 'admin.structure.roomOccupied' }
    await db.room.delete({ where: { id } })
    await audit(ctx, { action: 'admin.room.delete', entityType: 'Room', entityId: id, before: { number: r.number, beds: r.beds, unitId: r.unitId } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}

// ───────── Teams ─────────

export async function saveTeamAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const name = fd(form, 'name').slice(0, 120)
    const unitId = fd(form, 'unitId') || null
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    if (unitId && !(await unitInOrg(ctx, unitId))) return { ok: false, error: 'admin.structure.pickUnit', field: 'unitId' }
    if (id) {
      const before = await db.team.findFirst({ where: { id, orgId: ctx.org.id } })
      if (!before) return { ok: false, error: 'common.notFound' }
      await db.team.update({ where: { id }, data: { name, unitId } })
      await audit(ctx, { action: 'admin.team.update', entityType: 'Team', entityId: id, before, after: { name, unitId } })
    } else {
      const tm = await db.team.create({ data: { orgId: ctx.org.id, name, unitId } })
      await audit(ctx, { action: 'admin.team.create', entityType: 'Team', entityId: tm.id, after: { name, unitId } })
    }
    refresh()
  })
}

export async function deleteTeamAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const tm = await db.team.findFirst({ where: { id, orgId: ctx.org.id }, include: { members: true } })
    if (!tm) return { ok: false, error: 'common.notFound' }
    await db.team.delete({ where: { id } })
    await audit(ctx, { action: 'admin.team.delete', entityType: 'Team', entityId: id, before: { name: tm.name, unitId: tm.unitId, members: tm.members.map((m) => m.userId) } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}

export async function addTeamMemberAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const teamId = fd(form, 'teamId')
    const userId = fd(form, 'userId')
    const [tm, u] = await Promise.all([db.team.findFirst({ where: { id: teamId, orgId: ctx.org.id } }), db.user.findFirst({ where: { id: userId, orgId: ctx.org.id } })])
    if (!tm || !u) return { ok: false, error: 'admin.structure.pickUser', field: 'userId' }
    await db.teamMember.upsert({ where: { teamId_userId: { teamId, userId } }, create: { teamId, userId }, update: {} })
    await audit(ctx, { action: 'admin.team.member_add', entityType: 'Team', entityId: teamId, after: { userId } })
    refresh()
  })
}

export async function removeTeamMemberAction(teamId: string, userId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const tm = await db.team.findFirst({ where: { id: teamId, orgId: ctx.org.id } })
    if (!tm) return { ok: false, error: 'common.notFound' }
    await db.teamMember.deleteMany({ where: { teamId, userId } })
    await audit(ctx, { action: 'admin.team.member_remove', entityType: 'Team', entityId: teamId, before: { userId } })
    refresh()
  })
}
