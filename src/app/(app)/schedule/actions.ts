'use server'

import { refresh } from 'next/cache'
import type { AbsenceKind, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan, ForbiddenError, type Ctx } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify, usersWithPermission } from '@/lib/notify'
import { dateKey, dbDate, fromDbDate, parseDateKey, startOfDay, weekdayShort, fmtDayMonth, fmtDbDate } from '@/lib/time'
import { weekStart } from './lib'

const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })
const KINDS: AbsenceKind[] = ['vacation', 'sick', 'training', 'compensation', 'other']

function parseDay(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = parseDateKey(s)
  return Number.isNaN(d.getTime()) ? null : d
}

const label = (ctx: Ctx, s: { date: Date; shiftType: { name: string } }) => {
  const d = fromDbDate(s.date)
  return { shift: s.shiftType.name, date: `${weekdayShort(d, ctx.locale)} ${fmtDayMonth(d)}` }
}
const weekHref = (date: Date) => `/schedule?w=${dateKey(weekStart(fromDbDate(date)))}`

async function unitInScope(ctx: Ctx, unitId: string) {
  const unit = ctx.units.find((u) => u.id === unitId)
  if (!unit) throw new ForbiddenError('schedule.manage')
  return unit
}
async function assertManage(ctx: Ctx, unitId: string) {
  const unit = await unitInScope(ctx, unitId)
  assertCan(ctx, 'schedule.manage', { unitId: unit.id, locationId: unit.locationId })
  return unit
}

/** Bereiche einer Person (Rolle, Hauptbereich, Dienste) – für Freigaben durch die zuständige Leitung. */
async function managesUser(ctx: Ctx, userId: string) {
  const [u, roles, shifts] = await Promise.all([
    db.user.findFirst({ where: { id: userId, orgId: ctx.org.id }, select: { primaryUnitId: true } }),
    db.roleAssignment.findMany({ where: { userId, unitId: { not: null } }, select: { unitId: true } }),
    db.shift.findMany({ where: { userId, date: { gte: dbDate(new Date(Date.now() - 60 * 864e5)) } }, select: { unitId: true }, distinct: ['unitId'] }),
  ])
  if (!u) return false
  const ids = new Set([u.primaryUnitId, ...roles.map((r) => r.unitId), ...shifts.map((s) => s.unitId)].filter(Boolean) as string[])
  return ctx.units.some((x) => ids.has(x.id) && ctx.can('schedule.manage', { unitId: x.id, locationId: x.locationId }))
}

async function leadsFor(ctx: Ctx, unitId: string | null | undefined) {
  return (await usersWithPermission(ctx.org.id, 'schedule.manage', unitId ?? undefined)).filter((id) => id !== ctx.user.id)
}

async function changed(ctx: Ctx, unitId: string | null, payload: Record<string, unknown>) {
  await emit({ orgId: ctx.org.id, type: 'schedule.changed', unitId, actorId: ctx.user.id, payload })
}

async function bookedOn(userId: string, date: Date, exceptShiftId?: string) {
  return db.shift.findFirst({ where: { userId, date, status: { not: 'cancelled' }, ...(exceptShiftId ? { id: { not: exceptShiftId } } : {}) } })
}

// ───────── Dienste (Leitung) ─────────

export async function saveShiftAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const id = fd(form, 'id')
    const existing = id ? await db.shift.findFirst({ where: { id, unit: { orgId: ctx.org.id } }, include: { shiftType: true } }) : null
    if (id && !existing) return err('common.notFound')
    const unit = await assertManage(ctx, existing?.unitId ?? fd(form, 'unitId'))
    const type = await db.shiftType.findFirst({ where: { id: fd(form, 'shiftTypeId'), orgId: ctx.org.id } })
    if (!type) return err('schedule.errors.type', 'shiftTypeId')
    const day = parseDay(fd(form, 'date'))
    if (!day) return err('schedule.errors.date', 'date')
    const userId = fd(form, 'userId') || null
    if (userId) {
      const u = await db.user.findFirst({ where: { id: userId, orgId: ctx.org.id, active: true } })
      if (!u) return err('schedule.errors.person', 'userId')
      if (await bookedOn(userId, dbDate(day), existing?.id)) return err('schedule.errors.double', 'userId')
    }
    const data = {
      unitId: unit.id, shiftTypeId: type.id, date: dbDate(day), userId,
      requiredQualification: fd(form, 'requiredQualification') || null,
      note: fd(form, 'note').slice(0, 500) || null,
    }
    const userChanged = existing && existing.userId !== userId
    const status = !userId ? 'open' : existing && !userChanged && existing.status === 'swap_requested' ? 'swap_requested' : 'planned'
    const saved = await db.$transaction(async (tx) => {
      if (userChanged) await tx.swapRequest.updateMany({ where: { shiftId: existing!.id, status: 'requested' }, data: { status: 'rejected', decidedById: ctx.user.id, decidedAt: new Date() } })
      return existing
        ? tx.shift.update({ where: { id: existing.id }, data: { ...data, status }, include: { shiftType: true } })
        : tx.shift.create({ data: { ...data, status }, include: { shiftType: true } })
    })
    await audit(ctx, {
      action: existing ? 'shift.update' : 'shift.create', entityType: 'Shift', entityId: saved.id,
      before: existing ? { userId: existing.userId, shiftType: existing.shiftType.code, date: dateKey(fromDbDate(existing.date)), status: existing.status } : undefined,
      after: { userId, shiftType: type.code, date: dateKey(day), status, requiredQualification: data.requiredQualification },
    })
    const l = label(ctx, saved)
    const href = weekHref(saved.date)
    if (userId && (!existing || userChanged)) await notify({ orgId: ctx.org.id, userIds: [userId], priority: 'info', kind: 'schedule', title: ctx.t('schedule.plan.notifyAssigned', l), href })
    else if (userId && existing && (existing.shiftTypeId !== type.id || existing.date.getTime() !== saved.date.getTime()))
      await notify({ orgId: ctx.org.id, userIds: [userId], priority: 'action', kind: 'schedule', title: ctx.t('schedule.plan.notifyChanged', l), href })
    if (existing?.userId && userChanged) await notify({ orgId: ctx.org.id, userIds: [existing.userId], priority: 'action', kind: 'schedule', title: ctx.t('schedule.plan.notifyRemoved', label(ctx, existing)), href: weekHref(existing.date) })
    if (!userId && (!existing || existing.userId)) await notifyOpenShift(ctx, saved)
    await changed(ctx, unit.id, { shiftId: saved.id })
    refresh()
    return { ok: true, message: 'schedule.plan.saved' }
  })
}

async function notifyOpenShift(ctx: Ctx, s: { unitId: string; date: Date; shiftType: { name: string } }) {
  const staff = await db.user.findMany({
    where: { orgId: ctx.org.id, active: true, id: { not: ctx.user.id }, OR: [{ roles: { some: { unitId: s.unitId } } }, { teams: { some: { team: { unitId: s.unitId } } } }] },
    select: { id: true },
  })
  await notify({ orgId: ctx.org.id, userIds: staff.map((u) => u.id), priority: 'info', kind: 'schedule', title: ctx.t('schedule.open.notifyNew', label(ctx, s)), href: '/schedule?view=open', groupKey: `open-shifts:${s.unitId}` })
}

export async function deleteShiftAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const s = await db.shift.findFirst({ where: { id, unit: { orgId: ctx.org.id } }, include: { shiftType: true } })
    if (!s) return err('common.notFound')
    await assertManage(ctx, s.unitId)
    await db.shift.delete({ where: { id: s.id } })
    await audit(ctx, { action: 'shift.delete', entityType: 'Shift', entityId: s.id, before: { userId: s.userId, shiftType: s.shiftType.code, date: dateKey(fromDbDate(s.date)), status: s.status } })
    if (s.userId) await notify({ orgId: ctx.org.id, userIds: [s.userId], priority: 'action', kind: 'schedule', title: ctx.t('schedule.plan.notifyRemoved', label(ctx, s)), href: weekHref(s.date) })
    await changed(ctx, s.unitId, { shiftId: s.id, deleted: true })
    refresh()
    return { ok: true, message: 'schedule.plan.deleted' }
  })
}

// ───────── Soll-Besetzung ─────────

export async function saveTargetsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'schedule.manage')
    const types = await db.shiftType.findMany({ where: { orgId: ctx.org.id } })
    const coverage: Record<string, number> = {}
    for (const st of types) {
      const v = Number(fd(form, 'target_' + st.code))
      if (!Number.isInteger(v) || v < 0 || v > 50) return err('schedule.errors.target', 'target_' + st.code)
      coverage[st.code] = v
    }
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const before = ((org.settings ?? {}) as Record<string, unknown>).coverage ?? null
    const settings = { ...((org.settings ?? {}) as Record<string, unknown>), coverage }
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: settings as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'schedule.coverage.update', entityType: 'Organization', entityId: ctx.org.id, before, after: coverage })
    await changed(ctx, null, { coverage: true })
    refresh()
    return { ok: true, message: 'schedule.coverage.targetsSaved' }
  })
}

// ───────── Abwesenheiten ─────────

export async function requestAbsenceAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'schedule.read')
    const kind = fd(form, 'kind') as AbsenceKind
    if (!KINDS.includes(kind)) return err('schedule.errors.kind', 'kind')
    const from = parseDay(fd(form, 'from'))
    const to = parseDay(fd(form, 'to') || fd(form, 'from'))
    if (!from) return err('schedule.errors.date', 'from')
    if (!to) return err('schedule.errors.date', 'to')
    if (to < from) return err('schedule.errors.range', 'to')
    const sick = kind === 'sick'
    const a = await db.absence.create({
      data: { userId: ctx.user.id, kind, from: dbDate(from), to: dbDate(to), note: fd(form, 'note').slice(0, 500) || null, status: sick ? 'approved' : 'requested' },
    })
    await audit(ctx, { action: sick ? 'absence.sick' : 'absence.request', entityType: 'Absence', entityId: a.id, after: { kind, from: dateKey(from), to: dateKey(to), status: a.status } })
    const name = `${ctx.user.firstName} ${ctx.user.lastName}`
    const unitId = ctx.unit?.id ?? ctx.user.primaryUnitId
    await notify({
      orgId: ctx.org.id, userIds: await leadsFor(ctx, unitId), priority: 'action', kind: 'schedule',
      title: ctx.t(sick ? 'schedule.absence.notifySick' : 'schedule.absence.notifyRequest', { name, from: fmtDbDate(a.from, ctx.locale), to: fmtDbDate(a.to, ctx.locale) }),
      href: '/schedule?view=absences', groupKey: sick ? undefined : `absence-requests:${unitId ?? ctx.org.id}`,
    })
    await changed(ctx, unitId ?? null, { absenceId: a.id })
    refresh()
    return { ok: true, message: sick ? 'schedule.absence.sickSaved' : 'schedule.absence.saved' }
  })
}

export async function decideAbsenceAction(id: string, approve: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const a = await db.absence.findFirst({ where: { id, user: { orgId: ctx.org.id } } })
    if (!a) return err('common.notFound')
    if (a.status !== 'requested') return err('schedule.errors.state')
    if (a.userId === ctx.user.id || !(await managesUser(ctx, a.userId))) throw new ForbiddenError('schedule.manage')
    const status = approve ? 'approved' : 'rejected'
    await db.absence.update({ where: { id: a.id }, data: { status, decidedById: ctx.user.id, decidedAt: new Date() } })
    await audit(ctx, { action: 'absence.' + status, entityType: 'Absence', entityId: a.id, before: { status: a.status }, after: { status } })
    await notify({
      orgId: ctx.org.id, userIds: [a.userId], priority: 'info', kind: 'schedule',
      title: ctx.t('schedule.absence.notifyDecided', { kind: ctx.t('schedule.absence.kinds.' + a.kind), from: fmtDbDate(a.from, ctx.locale), to: fmtDbDate(a.to, ctx.locale), status: ctx.t('schedule.approval.' + status) }),
      href: '/schedule?view=absences',
    })
    await changed(ctx, ctx.unit?.id ?? null, { absenceId: a.id })
    refresh()
    return { ok: true, message: 'schedule.absence.decided' }
  })
}

export async function withdrawAbsenceAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const a = await db.absence.findFirst({ where: { id, userId: ctx.user.id } })
    if (!a) return err('common.notFound')
    if (a.status !== 'requested' && fromDbDate(a.to) < startOfDay()) return err('schedule.errors.state')
    await db.absence.delete({ where: { id: a.id } })
    await audit(ctx, { action: 'absence.withdraw', entityType: 'Absence', entityId: a.id, before: { kind: a.kind, from: dateKey(fromDbDate(a.from)), to: dateKey(fromDbDate(a.to)), status: a.status } })
    await changed(ctx, ctx.unit?.id ?? null, { absenceId: a.id })
    refresh()
    return { ok: true, message: 'schedule.absence.withdrawn' }
  })
}

// ───────── Schichttausch und offene Dienste ─────────

export async function requestSwapAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'schedule.read')
    const s = await db.shift.findFirst({ where: { id: fd(form, 'shiftId'), unit: { orgId: ctx.org.id } }, include: { shiftType: true } })
    if (!s) return err('common.notFound')
    if (s.userId !== ctx.user.id) return err('schedule.errors.notOwn')
    if (fromDbDate(s.date) < startOfDay()) return err('schedule.errors.past')
    if (s.status !== 'planned') return err('schedule.errors.state')
    const takerId = fd(form, 'takerId') || null
    if (takerId) {
      const u = await db.user.findFirst({ where: { id: takerId, orgId: ctx.org.id, active: true } })
      if (!u || u.id === ctx.user.id) return err('schedule.errors.person', 'takerId')
      if (await bookedOn(u.id, s.date)) return err('schedule.swap.takerBooked', 'takerId')
    }
    const req = await db.$transaction(async (tx) => {
      const r = await tx.swapRequest.create({ data: { shiftId: s.id, requesterId: ctx.user.id, takerId, note: fd(form, 'note').slice(0, 500) || null } })
      await tx.shift.update({ where: { id: s.id }, data: { status: 'swap_requested' } })
      return r
    })
    await audit(ctx, { action: 'swap.request', entityType: 'SwapRequest', entityId: req.id, after: { shiftId: s.id, takerId } })
    const l = { ...label(ctx, s), name: `${ctx.user.firstName} ${ctx.user.lastName}` }
    if (takerId) await notify({ orgId: ctx.org.id, userIds: [takerId], priority: 'action', kind: 'schedule', title: ctx.t('schedule.swap.notifyRequest', l), href: '/schedule?view=swaps' })
    else {
      const staff = await db.user.findMany({ where: { orgId: ctx.org.id, active: true, id: { not: ctx.user.id }, OR: [{ roles: { some: { unitId: s.unitId } } }, { teams: { some: { team: { unitId: s.unitId } } } }] }, select: { id: true } })
      await notify({ orgId: ctx.org.id, userIds: staff.map((u) => u.id), priority: 'info', kind: 'schedule', title: ctx.t('schedule.swap.notifyRequest', l), href: '/schedule?view=swaps', groupKey: `swap-open:${s.unitId}` })
    }
    await changed(ctx, s.unitId, { shiftId: s.id, swap: req.id })
    refresh()
    return { ok: true, message: 'schedule.swap.saved' }
  })
}

async function loadSwap(ctx: Ctx, id: string) {
  return db.swapRequest.findFirst({ where: { id, shift: { unit: { orgId: ctx.org.id } } }, include: { shift: { include: { shiftType: true } } } })
}

export async function acceptSwapAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'schedule.read')
    const r = await loadSwap(ctx, id)
    if (!r) return err('common.notFound')
    if (r.status !== 'requested' || r.acceptedAt || (r.takerId && r.takerId !== ctx.user.id) || r.requesterId === ctx.user.id || !ctx.unitIds.includes(r.shift.unitId)) return err('schedule.errors.state')
    if (await bookedOn(ctx.user.id, r.shift.date)) return err('schedule.swap.conflict')
    await db.swapRequest.update({ where: { id: r.id }, data: { takerId: ctx.user.id, acceptedAt: new Date() } })
    await audit(ctx, { action: 'swap.accept', entityType: 'SwapRequest', entityId: r.id, after: { takerId: ctx.user.id } })
    const requester = await db.user.findUnique({ where: { id: r.requesterId }, select: { firstName: true, lastName: true } })
    const l = { ...label(ctx, r.shift), name: `${ctx.user.firstName} ${ctx.user.lastName}`, from: requester ? `${requester.firstName} ${requester.lastName}` : '' }
    await notify({ orgId: ctx.org.id, userIds: await leadsFor(ctx, r.shift.unitId), priority: 'action', kind: 'schedule', title: ctx.t('schedule.swap.notifyAccepted', l), href: '/schedule?view=swaps', groupKey: `swap-approve:${r.shift.unitId}` })
    await notify({ orgId: ctx.org.id, userIds: [r.requesterId], priority: 'info', kind: 'schedule', title: ctx.t('schedule.swap.notifyAccepted', l), href: '/schedule?view=swaps' })
    await changed(ctx, r.shift.unitId, { swap: r.id })
    refresh()
    return { ok: true, message: 'schedule.swap.accepted' }
  })
}

export async function declineSwapAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const r = await loadSwap(ctx, id)
    if (!r) return err('common.notFound')
    if (r.status !== 'requested' || r.takerId !== ctx.user.id) return err('schedule.errors.state')
    await db.$transaction([
      db.swapRequest.update({ where: { id: r.id }, data: { status: 'rejected', decidedById: ctx.user.id, decidedAt: new Date() } }),
      db.shift.update({ where: { id: r.shiftId }, data: { status: 'planned' } }),
    ])
    await audit(ctx, { action: 'swap.decline', entityType: 'SwapRequest', entityId: r.id, after: { status: 'rejected' } })
    await notify({ orgId: ctx.org.id, userIds: [r.requesterId], priority: 'info', kind: 'schedule', title: ctx.t('schedule.swap.notifyDecided', { ...label(ctx, r.shift), status: ctx.t('schedule.approval.rejected') }), href: '/schedule?view=swaps' })
    await changed(ctx, r.shift.unitId, { swap: r.id })
    refresh()
    return { ok: true, message: 'schedule.swap.declined' }
  })
}

/** Eigene Anfrage oder Bewerbung zurückziehen. */
export async function cancelSwapAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const r = await loadSwap(ctx, id)
    if (!r) return err('common.notFound')
    if (r.status !== 'requested' || r.requesterId !== ctx.user.id) return err('schedule.errors.state')
    await db.$transaction(async (tx) => {
      await tx.swapRequest.delete({ where: { id: r.id } })
      if (r.shift.status === 'swap_requested' && r.shift.userId === ctx.user.id) await tx.shift.update({ where: { id: r.shiftId }, data: { status: 'planned' } })
    })
    await audit(ctx, { action: 'swap.withdraw', entityType: 'SwapRequest', entityId: r.id, before: { shiftId: r.shiftId, takerId: r.takerId } })
    await changed(ctx, r.shift.unitId, { swap: r.id })
    refresh()
    return { ok: true, message: 'schedule.swap.withdrawn' }
  })
}

/** Leitung: Tausch freigeben oder ablehnen; bei offenen Diensten Bewerbung bestätigen. */
export async function decideSwapAction(id: string, approve: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const r = await loadSwap(ctx, id)
    if (!r) return err('common.notFound')
    await assertManage(ctx, r.shift.unitId)
    if (r.status !== 'requested') return err('schedule.errors.state')
    const openShift = r.shift.status === 'open' && !r.shift.userId
    if (approve && (!r.takerId || !r.acceptedAt)) return err('schedule.errors.state')
    if (approve && (await bookedOn(r.takerId!, r.shift.date, r.shiftId))) return err('schedule.errors.double')
    const now = new Date()
    const rejectedOthers = approve && openShift ? await db.swapRequest.findMany({ where: { shiftId: r.shiftId, status: 'requested', id: { not: r.id } } }) : []
    await db.$transaction(async (tx) => {
      await tx.swapRequest.update({ where: { id: r.id }, data: { status: approve ? 'approved' : 'rejected', decidedById: ctx.user.id, decidedAt: now } })
      if (approve) {
        await tx.shift.update({ where: { id: r.shiftId }, data: { userId: r.takerId, status: 'planned' } })
        if (rejectedOthers.length) await tx.swapRequest.updateMany({ where: { id: { in: rejectedOthers.map((x) => x.id) } }, data: { status: 'rejected', decidedById: ctx.user.id, decidedAt: now } })
      } else if (!openShift) await tx.shift.update({ where: { id: r.shiftId }, data: { status: 'planned' } })
    })
    await audit(ctx, {
      action: (openShift ? 'shift.open.' : 'swap.') + (approve ? 'approve' : 'reject'), entityType: 'Shift', entityId: r.shiftId,
      before: { userId: r.shift.userId, status: r.shift.status }, after: approve ? { userId: r.takerId, status: 'planned' } : { status: openShift ? 'open' : 'planned' }, context: { swapRequestId: r.id },
    })
    const l = label(ctx, r.shift)
    const status = ctx.t('schedule.approval.' + (approve ? 'approved' : 'rejected'))
    if (openShift) {
      if (approve) await notify({ orgId: ctx.org.id, userIds: [r.takerId!], priority: 'action', kind: 'schedule', title: ctx.t('schedule.open.notifyConfirmed', l), href: weekHref(r.shift.date) })
      const others = approve ? rejectedOthers.map((x) => x.requesterId) : [r.requesterId]
      await notify({ orgId: ctx.org.id, userIds: others, priority: 'info', kind: 'schedule', title: ctx.t('schedule.open.notifyRejected', l), href: '/schedule?view=open' })
    } else {
      await notify({ orgId: ctx.org.id, userIds: [r.requesterId, ...(r.takerId ? [r.takerId] : [])], priority: approve ? 'action' : 'info', kind: 'schedule', title: ctx.t('schedule.swap.notifyDecided', { ...l, status }), href: weekHref(r.shift.date) })
    }
    await changed(ctx, r.shift.unitId, { shiftId: r.shiftId, swap: r.id })
    refresh()
    return { ok: true, message: approve ? (openShift ? 'schedule.open.confirmed' : 'schedule.swap.approved') : 'schedule.swap.rejectedMsg' }
  })
}

export async function applyOpenShiftAction(shiftId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'schedule.read')
    const s = await db.shift.findFirst({ where: { id: shiftId, unitId: { in: ctx.unitIds } }, include: { shiftType: true, swaps: true } })
    if (!s || s.status !== 'open' || s.userId) return err('schedule.errors.state')
    if (fromDbDate(s.date) < startOfDay()) return err('schedule.errors.past')
    if (s.swaps.some((x) => x.requesterId === ctx.user.id && x.status === 'requested')) return err('schedule.open.applied')
    if (await bookedOn(ctx.user.id, s.date)) return err('schedule.swap.conflict')
    const now = new Date()
    const r = await db.swapRequest.create({ data: { shiftId: s.id, requesterId: ctx.user.id, takerId: ctx.user.id, acceptedAt: now } })
    await audit(ctx, { action: 'shift.open.apply', entityType: 'SwapRequest', entityId: r.id, after: { shiftId: s.id } })
    await notify({ orgId: ctx.org.id, userIds: await leadsFor(ctx, s.unitId), priority: 'action', kind: 'schedule', title: ctx.t('schedule.open.notifyApply', { ...label(ctx, s), name: `${ctx.user.firstName} ${ctx.user.lastName}` }), href: '/schedule?view=open', groupKey: `open-apply:${s.unitId}` })
    await changed(ctx, s.unitId, { shiftId: s.id, swap: r.id })
    refresh()
    return { ok: true, message: 'schedule.open.applySaved' }
  })
}
