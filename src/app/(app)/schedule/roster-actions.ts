'use server'

import Anthropic from '@anthropic-ai/sdk'
import { refresh } from 'next/cache'
import { after } from 'next/server'
import { Prisma as PrismaNS, type Prisma } from '@prisma/client'
import { parseShiftTypeForm } from '@/lib/shift-types'
import { STAFF_GROUPS, type StaffGroup } from '@/lib/roster/groups'
import { db } from '@/lib/db'
import { getCtx, assertCan, ForbiddenError, type Ctx } from '@/lib/context'
import { run, fd, fdNum, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify } from '@/lib/notify'
import { aiConfigured } from '@/lib/env'
import { AiUnavailable } from '@/lib/ai'
import { captureError } from '@/lib/errors'
import { dateKey, dbDate, fmtDate, parseDateKey } from '@/lib/time'
import { DEFAULT_RULES, RULE_LIMITS, cellKey, monthDays, readShiftPrefs, rosterRules, shiftDay, type Grid, type RRules } from '@/lib/roster/model'
import { evaluate } from '@/lib/roster/evaluate'
import { diffGrids, plan, type PersonConstraint } from '@/lib/roster/solver'
import { MONTH_RE, loadRoster, monthStart, periodStatus } from '@/lib/roster/server'
import { aiRoster } from '@/lib/roster/ai'
import { dbKey } from './lib'

const err = (error: string, field?: string): ActionResult<never> => ({ ok: false, error, field })
export type CellChange = { user: string; day: string; code: string | null }

async function managedUnit(ctx: Ctx, unitId: string) {
  const unit = ctx.units.find((u) => u.id === unitId)
  if (!unit) throw new ForbiddenError('schedule.manage')
  assertCan(ctx, 'schedule.manage', { unitId: unit.id, locationId: unit.locationId })
  return unit
}

const monthLabel = (ctx: Ctx, month: string) => fmtDate(monthStart(month), ctx.locale, { month: 'long', year: 'numeric' })
const monthHref = (month: string) => `/schedule?view=month&m=${month}`

/** Leerer Monat ohne Freigabestatus: wird beim ersten Planen als Entwurf geführt (für das Team noch unsichtbar). */
async function ensureDraftForEmptyMonth(ctx: Ctx, unitId: string, month: string) {
  const { row } = await periodStatus(unitId, month)
  if (row) return row.status
  const days = monthDays(month)
  const n = await db.shift.count({ where: { unitId, userId: { not: null }, status: { not: 'cancelled' }, date: { gte: dbDate(parseDateKey(days[0])), lte: dbDate(parseDateKey(days[days.length - 1])) } } })
  if (n > 0) return 'released' as const
  await db.schedulePeriod.create({ data: { orgId: ctx.org.id, unitId, month: dbDate(monthStart(month)), status: 'draft' } })
  return 'draft' as const
}

/**
 * Zelländerungen schreiben (eine Person, ein Tag, ein Dienst). Dienste in anderen Bereichen und laufende
 * Tauschanfragen bleiben unangetastet; ein offener Dienst gleicher Art wird bevorzugt vergeben statt neu angelegt.
 */
async function applyChanges(ctx: Ctx, unitId: string, month: string, changes: CellChange[], source: string) {
  const days = new Set(monthDays(month))
  const types = await db.shiftType.findMany({ where: { orgId: ctx.org.id } })
  const byCode = new Map(types.map((t) => [t.code, t]))
  const userIds = [...new Set(changes.map((c) => c.user))]
  const users = new Set((await db.user.findMany({ where: { id: { in: userIds }, orgId: ctx.org.id, active: true }, select: { id: true } })).map((u) => u.id))
  const dates = [...new Set(changes.map((c) => c.day))].map((d) => dbDate(parseDateKey(d)))
  const [existing, open, approved] = await Promise.all([
    db.shift.findMany({ where: { userId: { in: userIds }, date: { in: dates }, status: { not: 'cancelled' } } }),
    db.shift.findMany({ where: { unitId, userId: null, status: 'open', date: { in: dates }, swaps: { none: { status: 'requested' } } } }),
    db.absence.findMany({ where: { userId: { in: userIds }, status: 'approved', from: { lte: dates.reduce((a, b) => (a > b ? a : b), dates[0] ?? new Date()) }, to: { gte: dates.reduce((a, b) => (a < b ? a : b), dates[0] ?? new Date()) } } }),
  ])
  const at = new Map(existing.map((s) => [cellKey(s.userId!, dbKey(s.date)), s]))
  const skipped: { change: CellChange; reason: string }[] = []
  const done: (CellChange & { from: string | null })[] = []
  const codeOf = new Map(types.map((t) => [t.id, t.code]))
  await db.$transaction(async (tx) => {
    for (const c of changes) {
      if (!days.has(c.day) || !users.has(c.user) || (c.code && !byCode.has(c.code))) { skipped.push({ change: c, reason: 'invalid' }); continue }
      const k = cellKey(c.user, c.day)
      const cur = at.get(k)
      const date = dbDate(parseDateKey(c.day))
      if (cur && cur.unitId !== unitId) { skipped.push({ change: c, reason: 'foreign' }); continue }
      if (cur && cur.status === 'swap_requested') { skipped.push({ change: c, reason: 'swap' }); continue }
      if (c.code && approved.some((a) => a.userId === c.user && a.from <= date && a.to >= date)) { skipped.push({ change: c, reason: 'absent' }); continue }
      const type = c.code ? byCode.get(c.code)! : null
      const from = cur ? codeOf.get(cur.shiftTypeId) ?? null : null
      if (!type) {
        if (cur) { await tx.shift.delete({ where: { id: cur.id } }); at.delete(k); done.push({ ...c, from }) }
        continue
      }
      if (cur) {
        if (cur.shiftTypeId !== type.id) { await tx.shift.update({ where: { id: cur.id }, data: { shiftTypeId: type.id } }); done.push({ ...c, from }) }
        continue
      }
      const oi = open.findIndex((o) => o.shiftTypeId === type.id && o.date.getTime() === date.getTime())
      const s = oi >= 0
        ? await tx.shift.update({ where: { id: open.splice(oi, 1)[0].id }, data: { userId: c.user, status: 'planned' } })
        : await tx.shift.create({ data: { unitId, userId: c.user, shiftTypeId: type.id, date, status: 'planned' } })
      at.set(k, s)
      done.push({ ...c, from })
    }
  }, { timeout: 30000 })
  if (done.length) {
    await audit(ctx, { action: 'roster.cells', entityType: 'Unit', entityId: unitId, after: { month, source, n: done.length, changes: done.slice(0, 300) } })
    const { status } = await periodStatus(unitId, month)
    const today = dateKey(new Date())
    if (status === 'released') {
      const per = new Map<string, number>()
      for (const c of done) if (c.day >= today) per.set(c.user, (per.get(c.user) ?? 0) + 1)
      for (const [userId, n] of per)
        if (userId !== ctx.user.id) await notify({ orgId: ctx.org.id, userIds: [userId], priority: 'action', kind: 'schedule', title: ctx.t('roster.notifyChanged', { n, month: monthLabel(ctx, month) }), href: monthHref(month), groupKey: `roster:${unitId}:${month}` })
    }
    await emit({ orgId: ctx.org.id, type: 'schedule.changed', unitId, actorId: ctx.user.id, payload: { month, n: done.length } })
  }
  return { applied: done.length, skipped }
}

// ───────── Raster ─────────

export async function saveCellsAction(unitId: string, month: string, changes: CellChange[]): Promise<ActionResult<{ applied: number; skipped: number }>> {
  return run<{ applied: number; skipped: number }>(async () => {
    const ctx = await getCtx()
    await managedUnit(ctx, unitId)
    if (!MONTH_RE.test(month) || !Array.isArray(changes) || changes.length > 1000) return err('roster.errors.invalid')
    const clean = changes.filter((c) => c && typeof c.user === 'string' && typeof c.day === 'string' && (c.code === null || typeof c.code === 'string'))
    if (clean.some((c) => c.code)) await ensureDraftForEmptyMonth(ctx, unitId, month)
    const r = await applyChanges(ctx, unitId, month, clean, 'manual')
    refresh()
    return { ok: true, data: { applied: r.applied, skipped: r.skipped.length } }
  })
}

// ───────── Vorschläge (KI, automatisch, Vormonat) ─────────

type Summary = {
  coverageRate: number
  errors: number
  warnings: number
  wishes: { met: number; total: number }
  changes: number
  repairs: Record<string, number>
  notes?: string[]
  constraints?: { name: string; allowed?: string[]; offDays?: string[] }[]
  before: { coverageRate: number; errors: number }
}

async function computeProposal(ctx: Ctx, proposalId: string) {
  const pr = await db.scheduleProposal.findUniqueOrThrow({ where: { id: proposalId } })
  const month = dbKey(pr.month).slice(0, 7)
  const data = await loadRoster(ctx.org.id, ctx.org.settings, pr.unitId, month)
  const mode = pr.mode === 'fill' || pr.mode === 'adjust' ? pr.mode : 'replace'
  let seed: Grid | undefined
  let constraints: Record<string, PersonConstraint> | undefined
  let notes: string[] | undefined
  let model: string | null = null
  if (pr.source === 'copy') {
    // Vier-Wochen-Rhythmus: Dienst vom gleichen Wochentag 28 Tage früher
    const days = data.problem.days
    const prev = await db.shift.findMany({
      where: { unitId: pr.unitId, userId: { not: null }, status: { not: 'cancelled' }, date: { gte: dbDate(parseDateKey(shiftDay(days[0], -28))), lte: dbDate(parseDateKey(shiftDay(days[days.length - 1], -28))) } },
      include: { shiftType: true },
    })
    seed = {}
    for (const s of prev) seed[cellKey(s.userId!, shiftDay(dbKey(s.date), 28))] = s.shiftType.code
  } else if (pr.source === 'ai') {
    const r = await aiRoster(ctx, data.problem, data.current, mode, monthLabel(ctx, month), pr.instructions ?? '')
    seed = r.seed
    constraints = r.constraints
    notes = r.notes
    model = r.model
  }
  const result = plan(data.problem, data.current, { mode, seed, constraints, salt: pr.createdAt.getTime() % 997 })
  const ev = evaluate(data.problem, result.grid)
  const evBefore = evaluate(data.problem, data.current)
  const cells = diffGrids(data.problem, data.current, result.grid).map((c) => ({ u: c.user, d: c.day, c: c.to }))
  const repairs: Record<string, number> = {}
  for (const r of result.repairs) if (r.reason !== 'fill' || !seed) repairs[r.reason] = (repairs[r.reason] ?? 0) + 1
  const names = new Map(data.people.map((x) => [x.id, x.short]))
  const summary: Summary = {
    coverageRate: ev.coverageRate,
    errors: ev.issues.filter((i) => i.severity === 'error').length,
    warnings: ev.issues.filter((i) => i.severity === 'warn').length,
    wishes: ev.wishes,
    changes: cells.length,
    repairs,
    before: { coverageRate: evBefore.coverageRate, errors: evBefore.issues.filter((i) => i.severity === 'error').length },
    ...(notes ? { notes } : {}),
    ...(constraints ? { constraints: Object.entries(constraints).map(([id, c]) => ({ name: names.get(id) ?? '', ...c })) } : {}),
  }
  await db.scheduleProposal.update({ where: { id: pr.id }, data: { status: 'ready', cells: cells as Prisma.InputJsonValue, summary: summary as unknown as Prisma.InputJsonValue, model } })
}

export async function startProposalAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const ctx = await getCtx()
    const unit = await managedUnit(ctx, fd(form, 'unitId'))
    const month = fd(form, 'month')
    const source = fd(form, 'source')
    const mode = (['fill', 'adjust'] as const).find((m) => m === fd(form, 'mode')) ?? 'replace'
    if (!MONTH_RE.test(month) || !['ai', 'auto', 'copy'].includes(source)) return err('roster.errors.invalid')
    if (month < dateKey(new Date()).slice(0, 7)) return err('roster.errors.past')
    if (source === 'ai') {
      if (!aiConfigured()) return err('roster.ai.notConfigured')
      if (!ctx.hasModule('ai') || !ctx.can('ai.use')) return err('common.notAllowed')
    }
    const m = dbDate(monthStart(month))
    const running = await db.scheduleProposal.findFirst({ where: { unitId: unit.id, month: m, status: 'running', createdAt: { gte: new Date(Date.now() - 10 * 60000) } } })
    if (running) return err('roster.errors.running')
    await db.scheduleProposal.updateMany({ where: { unitId: unit.id, month: m, status: { in: ['ready', 'failed', 'running'] } }, data: { status: 'discarded', decidedAt: new Date(), decidedById: ctx.user.id } })
    await ensureDraftForEmptyMonth(ctx, unit.id, month)
    const pr = await db.scheduleProposal.create({
      data: { orgId: ctx.org.id, unitId: unit.id, month: m, source, mode, instructions: source === 'ai' ? fd(form, 'instructions').slice(0, 2000) || null : null, createdById: ctx.user.id },
    })
    await audit(ctx, { action: 'roster.proposal.create', entityType: 'ScheduleProposal', entityId: pr.id, after: { month, source, mode } })
    const work = async () => {
      try {
        await computeProposal(ctx, pr.id)
      } catch (e) {
        const api = e instanceof Anthropic.APIError ? e.status : undefined
        const reason = e instanceof AiUnavailable ? e.message
          : api === 401 || api === 403 ? 'auth' : api === 429 ? 'rate' : api && api >= 500 ? 'overloaded' : 'error'
        if (!(e instanceof AiUnavailable) && !api) await captureError(e, { route: 'roster-proposal', routeType: 'action' }).catch(() => console.error('[roster]', e))
        await db.scheduleProposal.update({ where: { id: pr.id }, data: { status: 'failed', error: reason } })
      }
    }
    if (source === 'ai') after(work)
    else await work()
    refresh()
    return { ok: true, data: { id: pr.id } }
  })
}

async function loadProposal(ctx: Ctx, id: string) {
  const pr = await db.scheduleProposal.findFirst({ where: { id, orgId: ctx.org.id } })
  if (!pr) return null
  await managedUnit(ctx, pr.unitId)
  return pr
}

export async function applyProposalAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const pr = await loadProposal(ctx, id)
    if (!pr) return err('common.notFound')
    if (pr.status !== 'ready') return err('roster.errors.state')
    const month = dbKey(pr.month).slice(0, 7)
    const today = dateKey(new Date())
    const cells = (pr.cells as { u: string; d: string; c: string | null }[]).filter((c) => c.d >= today)
    const r = await applyChanges(ctx, pr.unitId, month, cells.map((c) => ({ user: c.u, day: c.d, code: c.c })), pr.source)
    await db.scheduleProposal.update({ where: { id: pr.id }, data: { status: 'applied', decidedAt: new Date(), decidedById: ctx.user.id } })
    await audit(ctx, { action: 'roster.proposal.apply', entityType: 'ScheduleProposal', entityId: pr.id, after: { month, applied: r.applied, skipped: r.skipped.length } })
    refresh()
    return { ok: true, message: r.skipped.length ? 'roster.proposal.appliedPartly' : 'roster.proposal.applied' }
  })
}

export async function discardProposalAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const pr = await loadProposal(ctx, id)
    if (!pr) return err('common.notFound')
    if (!['ready', 'failed', 'running'].includes(pr.status)) return err('roster.errors.state')
    await db.scheduleProposal.update({ where: { id: pr.id }, data: { status: 'discarded', decidedAt: new Date(), decidedById: ctx.user.id } })
    await audit(ctx, { action: 'roster.proposal.discard', entityType: 'ScheduleProposal', entityId: pr.id })
    refresh()
    return { ok: true, message: 'roster.proposal.discarded' }
  })
}

// ───────── Freigabe ─────────

export async function setPeriodStatusAction(unitId: string, month: string, status: 'draft' | 'released'): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const unit = await managedUnit(ctx, unitId)
    if (!MONTH_RE.test(month) || !['draft', 'released'].includes(status)) return err('roster.errors.invalid')
    const m = dbDate(monthStart(month))
    const before = await periodStatus(unit.id, month)
    if (before.status === status) return err('roster.errors.state')
    await db.schedulePeriod.upsert({
      where: { unitId_month: { unitId: unit.id, month: m } },
      create: { orgId: ctx.org.id, unitId: unit.id, month: m, status, ...(status === 'released' ? { releasedAt: new Date(), releasedById: ctx.user.id } : {}) },
      update: { status, ...(status === 'released' ? { releasedAt: new Date(), releasedById: ctx.user.id } : {}) },
    })
    await audit(ctx, { action: status === 'released' ? 'roster.release' : 'roster.draft', entityType: 'Unit', entityId: unit.id, before: { status: before.status }, after: { month, status } })
    if (status === 'released') {
      const days = monthDays(month)
      const staff = await db.shift.findMany({ where: { unitId: unit.id, userId: { not: null }, status: { not: 'cancelled' }, date: { gte: dbDate(parseDateKey(days[0])), lte: dbDate(parseDateKey(days[days.length - 1])) } }, select: { userId: true }, distinct: ['userId'] })
      await notify({ orgId: ctx.org.id, userIds: staff.map((s) => s.userId!).filter((x) => x !== ctx.user.id), priority: 'action', kind: 'schedule', title: ctx.t('roster.notifyReleased', { month: monthLabel(ctx, month), unit: unit.name }), href: monthHref(month) })
    }
    await emit({ orgId: ctx.org.id, type: 'schedule.changed', unitId: unit.id, actorId: ctx.user.id, payload: { month, status } })
    refresh()
    return { ok: true, message: status === 'released' ? 'roster.period.releasedMsg' : 'roster.period.draftMsg' }
  })
}

// ───────── Pensum und Regeln ─────────

/** Pensum und dauerhafte Planungsvorgaben einer Person (nur bestimmte Dienste, bevorzugte Dienste, max. Nächte). */
export async function savePersonPlanAction(unitId: string, userId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    await managedUnit(ctx, unitId)
    const pct = Number(fd(form, 'pct').replace(',', '.'))
    if (!Number.isInteger(pct) || pct < 5 || pct > 100) return err('roster.errors.pensum', 'pct')
    const nightsRaw = fd(form, 'maxNights')
    const maxNights = nightsRaw === '' ? null : Number(nightsRaw)
    if (maxNights != null && (!Number.isInteger(maxNights) || maxNights < 0 || maxNights > 31)) return err('roster.errors.maxNights', 'maxNights')
    const codes = (await db.shiftType.findMany({ where: { orgId: ctx.org.id }, select: { code: true } })).map((x) => x.code)
    const prefs = readShiftPrefs({ allowed: form.getAll('allowed'), preferred: form.getAll('preferred'), maxNights, group: fd(form, 'group') || null }, codes)
    const u = await db.user.findFirst({ where: { id: userId, orgId: ctx.org.id }, select: { id: true, employmentPct: true, shiftPrefs: true } })
    if (!u) return err('common.notFound')
    await db.user.update({ where: { id: u.id }, data: { employmentPct: pct, shiftPrefs: prefs as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'user.employment', entityType: 'User', entityId: u.id, before: { employmentPct: u.employmentPct, shiftPrefs: u.shiftPrefs }, after: { employmentPct: pct, shiftPrefs: prefs } })
    refresh()
    return { ok: true, message: 'roster.person.saved' }
  })
}

// ───────── Dienstarten (Leitung) ─────────

/** Dienstart anlegen oder ändern, inkl. Soll-Besetzung und Wochentagen (z. B. «Stübli» nur Mo–Fr). */
export async function saveRosterShiftTypeAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'schedule.manage')
    const parsed = parseShiftTypeForm(form)
    if (!parsed.ok) return parsed
    const { data } = parsed
    // Soll-Besetzung je Wochentag (t0 = So … t6 = Sa)
    const byDay: number[] = []
    for (let i = 0; i < 7; i++) {
      const v = Number(fd(form, 't' + i) || 0)
      if (!Number.isInteger(v) || v < 0 || v > 50) return err('schedule.errors.target', 't' + i)
      byDay.push(v)
    }
    const groups = STAFF_GROUPS.filter((g) => form.getAll('groups').includes(g))
    const min: Partial<Record<StaffGroup, number>> = {}
    for (const g of STAFF_GROUPS) {
      const v = Number(fd(form, 'min_' + g) || 0)
      if (!Number.isInteger(v) || v < 0 || v > 50) return err('roster.types.badMin', 'min_' + g)
      if (v > 0) min[g] = v
    }
    if (groups.length && Object.keys(min).some((g) => !groups.includes(g as StaffGroup))) return err('roster.types.minNotAllowed', 'groups')
    const id = fd(form, 'id')
    try {
      if (id) {
        const before = await db.shiftType.findFirst({ where: { id, orgId: ctx.org.id } })
        if (!before) return err('common.notFound')
        await db.shiftType.update({ where: { id }, data })
        await audit(ctx, { action: 'admin.config.shift_type', entityType: 'ShiftType', entityId: id, before: { code: before.code, name: before.name, start: before.start, end: before.end, breakMinutes: before.breakMinutes, color: before.color }, after: data })
      } else {
        const st = await db.shiftType.create({ data: { ...data, orgId: ctx.org.id } })
        await audit(ctx, { action: 'admin.config.shift_type_create', entityType: 'ShiftType', entityId: st.id, after: data })
      }
    } catch (e) {
      if (e instanceof PrismaNS.PrismaClientKnownRequestError && e.code === 'P2002') return err('admin.config.codeTaken', 'code')
      throw e
    }
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const settings = (org.settings ?? {}) as Record<string, unknown>
    const coverage = { ...((settings.coverage ?? {}) as Record<string, number>), [data.code]: Math.max(...byDay) }
    const coverageByDay = { ...((settings.coverageByDay ?? {}) as Record<string, number[]>), [data.code]: byDay }
    const coverageDays = { ...((settings.coverageDays ?? {}) as Record<string, number[]>) }
    delete coverageDays[data.code]
    const shiftRules = { ...((settings.shiftRules ?? {}) as Record<string, unknown>), [data.code]: { groups: groups.length === STAFF_GROUPS.length ? [] : groups, min } }
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...settings, coverage, coverageByDay, coverageDays, shiftRules } as Prisma.InputJsonValue } })
    await emit({ orgId: ctx.org.id, type: 'schedule.changed', unitId: null, actorId: ctx.user.id, payload: { shiftType: data.code } })
    refresh()
    return { ok: true, message: 'roster.types.saved' }
  })
}

export async function deleteRosterShiftTypeAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'schedule.manage')
    const st = await db.shiftType.findFirst({ where: { id, orgId: ctx.org.id }, include: { _count: { select: { shifts: true } } } })
    if (!st) return err('common.notFound')
    if (st._count.shifts) return err('admin.config.shiftTypeInUse')
    await db.shiftType.delete({ where: { id } })
    await audit(ctx, { action: 'admin.config.shift_type_delete', entityType: 'ShiftType', entityId: id, before: { code: st.code, name: st.name } })
    refresh()
    return { ok: true, message: 'roster.types.deleted' }
  })
}

export async function saveRosterRulesAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'schedule.manage')
    const roster = {} as RRules
    for (const k of Object.keys(DEFAULT_RULES) as (keyof RRules)[]) {
      const v = fdNum(form, k)
      const [lo, hi] = RULE_LIMITS[k]
      if (v == null || Number.isNaN(v) || v < lo || v > hi) return err('roster.errors.rule', k)
      roster[k] = Math.round(v * 4) / 4
    }
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const settings = (org.settings ?? {}) as Record<string, unknown>
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...settings, roster } as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'roster.rules', entityType: 'Organization', entityId: ctx.org.id, before: settings.roster ?? null, after: roster })
    refresh()
    return { ok: true, message: 'roster.rules.saved' }
  })
}

// ───────── Dienstwünsche (Mitarbeitende) ─────────

export async function saveWishAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'schedule.read')
    const day = fd(form, 'date')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parseDateKey(day).getTime())) return err('schedule.errors.date', 'date')
    if (day <= dateKey(new Date())) return err('roster.wish.past', 'date')
    const kind = fd(form, 'kind') === 'shift' ? 'shift' : 'off'
    let shiftTypeId: string | null = null
    if (kind === 'shift') {
      const st = await db.shiftType.findFirst({ where: { id: fd(form, 'shiftTypeId'), orgId: ctx.org.id } })
      if (!st) return err('schedule.errors.type', 'shiftTypeId')
      shiftTypeId = st.id
    }
    const days = monthDays(day.slice(0, 7))
    const rules = rosterRules(ctx.org.settings)
    const date = dbDate(parseDateKey(day))
    const others = await db.shiftWish.count({ where: { userId: ctx.user.id, date: { gte: dbDate(parseDateKey(days[0])), lte: dbDate(parseDateKey(days[days.length - 1])), not: date } } })
    if (others >= rules.maxWishes) return err('roster.wish.limit')
    const note = fd(form, 'note').slice(0, 200) || null
    await db.shiftWish.upsert({
      where: { userId_date: { userId: ctx.user.id, date } },
      create: { orgId: ctx.org.id, userId: ctx.user.id, date, kind, shiftTypeId, note },
      update: { kind, shiftTypeId, note },
    })
    await audit(ctx, { action: 'roster.wish.save', entityType: 'ShiftWish', entityId: ctx.user.id, after: { date: day, kind, shiftTypeId } })
    refresh()
    return { ok: true, message: 'roster.wish.saved' }
  })
}

export async function deleteWishAction(day: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return err('schedule.errors.date')
    const r = await db.shiftWish.deleteMany({ where: { userId: ctx.user.id, date: dbDate(parseDateKey(day)) } })
    if (!r.count) return err('common.notFound')
    await audit(ctx, { action: 'roster.wish.delete', entityType: 'ShiftWish', entityId: ctx.user.id, before: { date: day } })
    refresh()
    return { ok: true, message: 'roster.wish.deleted' }
  })
}
