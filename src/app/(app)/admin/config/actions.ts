'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, fdBool, fdNum, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { orgSettings } from '@/lib/admin'
import { FEATURE_FLAGS, TIME_RE, slugKey } from '@/lib/admin-shared'
import { VITALS, VITAL_KEYS } from '@/lib/vitals'
import { invalidateTaskGeneration } from '@/lib/tasks'

async function admin() {
  const ctx = await getCtx()
  assertCan(ctx, 'admin.config')
  return ctx
}

export async function saveDomainsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const rows = await db.careDomain.findMany({ where: { orgId: ctx.org.id }, orderBy: { order: 'asc' } })
    const after = rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: (fd(form, 'name:' + r.id) || r.name).slice(0, 80),
      order: Math.max(0, Math.min(999, Math.round(fdNum(form, 'order:' + r.id) ?? r.order))),
      active: fdBool(form, 'active:' + r.id),
    }))
    await db.$transaction(after.map((a) => db.careDomain.update({ where: { id: a.id }, data: { name: a.name, order: a.order, active: a.active } })))
    await audit(ctx, { action: 'admin.config.care_domains', entityType: 'CareDomain', before: rows.map(({ key, name, order, active }) => ({ key, name, order, active })), after: after.map(({ key, name, order, active }) => ({ key, name, order, active })) })
    refresh()
  })
}

export async function saveAssessmentAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const before = await db.assessmentDefinition.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!before) return { ok: false, error: 'common.notFound' }
    const iv = fdNum(form, 'intervalDays')
    if (iv != null && (!Number.isInteger(iv) || iv < 1 || iv > 730)) return { ok: false, error: 'admin.config.badInterval', field: 'intervalDays' }
    const after = { intervalDays: iv, active: fdBool(form, 'active'), name: (fd(form, 'name') || before.name).slice(0, 80) }
    await db.assessmentDefinition.update({ where: { id }, data: after })
    await audit(ctx, { action: 'admin.config.assessment', entityType: 'AssessmentDefinition', entityId: id, before: { intervalDays: before.intervalDays, active: before.active, name: before.name }, after })
    invalidateTaskGeneration()
    refresh()
  })
}

export async function saveThresholdsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const existing = await db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, residentId: null } })
    const next: { key: string; lo: number; hi: number }[] = []
    for (const k of VITAL_KEYS) {
      const lo = fdNum(form, 'lo:' + k)
      const hi = fdNum(form, 'hi:' + k)
      if (lo == null && hi == null) continue
      const v = VITALS[k]
      const l = lo ?? v.lo
      const h = hi ?? v.hi
      if (Number.isNaN(l) || Number.isNaN(h) || l >= h || l < 0 || (k !== 'weight' && (l < v.min - 1e-9 || h > v.max + 1e-9))) return { ok: false, error: ctx.t('admin.config.badThreshold', { name: ctx.t('common.vitals.' + k) }), field: 'lo:' + k }
      next.push({ key: k, lo: l, hi: h })
    }
    await db.$transaction(async (tx) => {
      for (const n of next) {
        const row = existing.find((e) => e.key === n.key)
        if (row) await tx.vitalThreshold.update({ where: { id: row.id }, data: { lo: n.lo, hi: n.hi } })
        else await tx.vitalThreshold.create({ data: { orgId: ctx.org.id, residentId: null, key: n.key, lo: n.lo, hi: n.hi } })
      }
    })
    await audit(ctx, { action: 'admin.config.vital_thresholds', entityType: 'VitalThreshold', before: existing.map(({ key, lo, hi }) => ({ key, lo, hi })), after: next })
    refresh()
  })
}

export async function resetThresholdAction(key: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const row = await db.vitalThreshold.findFirst({ where: { orgId: ctx.org.id, residentId: null, key } })
    if (!row) return { ok: true }
    await db.vitalThreshold.delete({ where: { id: row.id } })
    await audit(ctx, { action: 'admin.config.vital_threshold_reset', entityType: 'VitalThreshold', entityId: row.id, before: { key, lo: row.lo, hi: row.hi } })
    refresh()
    return { ok: true, message: 'admin.config.thresholdReset' }
  })
}

const Step = z.object({
  key: z.string().trim().max(40).optional().default(''),
  title: z.string().trim().min(1, 'admin.config.stepTitle').max(120),
  category: z.string().trim().max(60).optional().default(''),
  offsetMin: z.coerce.number().int().min(0).max(43200),
  durationMin: z.coerce.number().int().min(1).max(480),
})

export async function saveIncidentTypeAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const name = fd(form, 'name').slice(0, 80)
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    let raw: unknown
    try {
      raw = JSON.parse(fd(form, 'workflow') || '[]')
    } catch {
      return { ok: false, error: 'admin.config.badWorkflow' }
    }
    const parsed = z.array(Step).max(20).safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message.startsWith('admin.') ? parsed.error.issues[0].message : 'admin.config.badWorkflow' }
    const seen = new Set<string>()
    const workflow = parsed.data.map((s, i) => {
      let key = slugKey(s.key || s.title) || 'step_' + (i + 1)
      while (seen.has(key)) key += '_' + (i + 1)
      seen.add(key)
      return { ...s, key }
    })
    const active = fdBool(form, 'active')
    if (id) {
      const before = await db.incidentType.findFirst({ where: { id, orgId: ctx.org.id } })
      if (!before) return { ok: false, error: 'common.notFound' }
      await db.incidentType.update({ where: { id }, data: { name, active, workflow: workflow as Prisma.InputJsonValue } })
      await audit(ctx, { action: 'admin.config.incident_type', entityType: 'IncidentType', entityId: id, before: { name: before.name, active: before.active, workflow: before.workflow }, after: { name, active, workflow } })
    } else {
      const base = slugKey(name) || 'type'
      let key = base
      for (let i = 2; await db.incidentType.findUnique({ where: { orgId_key: { orgId: ctx.org.id, key } } }); i++) key = `${base}_${i}`
      const it = await db.incidentType.create({ data: { orgId: ctx.org.id, key, name, active, workflow: workflow as Prisma.InputJsonValue } })
      await audit(ctx, { action: 'admin.config.incident_type_create', entityType: 'IncidentType', entityId: it.id, after: { key, name, active, workflow } })
    }
    refresh()
  })
}

export async function saveShiftTypeAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const id = fd(form, 'id')
    const code = fd(form, 'code').toUpperCase()
    const data = { code, name: fd(form, 'name').slice(0, 60), start: fd(form, 'start'), end: fd(form, 'end') }
    if (!/^[A-Z0-9]{1,4}$/.test(code)) return { ok: false, error: 'admin.config.badCode', field: 'code' }
    if (data.name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    if (!TIME_RE.test(data.start)) return { ok: false, error: 'admin.config.badTime', field: 'start' }
    if (!TIME_RE.test(data.end)) return { ok: false, error: 'admin.config.badTime', field: 'end' }
    try {
      if (id) {
        const before = await db.shiftType.findFirst({ where: { id, orgId: ctx.org.id } })
        if (!before) return { ok: false, error: 'common.notFound' }
        await db.shiftType.update({ where: { id }, data })
        await audit(ctx, { action: 'admin.config.shift_type', entityType: 'ShiftType', entityId: id, before: { code: before.code, name: before.name, start: before.start, end: before.end }, after: data })
      } else {
        const st = await db.shiftType.create({ data: { ...data, orgId: ctx.org.id } })
        await audit(ctx, { action: 'admin.config.shift_type_create', entityType: 'ShiftType', entityId: st.id, after: data })
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, error: 'admin.config.codeTaken', field: 'code' }
      throw e
    }
    refresh()
  })
}

export async function deleteShiftTypeAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const st = await db.shiftType.findFirst({ where: { id, orgId: ctx.org.id }, include: { _count: { select: { shifts: true } } } })
    if (!st) return { ok: false, error: 'common.notFound' }
    if (st._count.shifts) return { ok: false, error: 'admin.config.shiftTypeInUse' }
    await db.shiftType.delete({ where: { id } })
    await audit(ctx, { action: 'admin.config.shift_type_delete', entityType: 'ShiftType', entityId: id, before: { code: st.code, name: st.name, start: st.start, end: st.end } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}

export async function saveCoverageAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const types = await db.shiftType.findMany({ where: { orgId: ctx.org.id } })
    const settings = orgSettings(ctx.org.settings)
    const coverage: Record<string, number> = {}
    for (const st of types) {
      const n = fdNum(form, 'cov:' + st.code)
      if (n == null) continue
      if (!Number.isInteger(n) || n < 0 || n > 50) return { ok: false, error: 'admin.config.badCoverage', field: 'cov:' + st.code }
      coverage[st.code] = n
    }
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...settings, coverage } as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'admin.config.coverage', entityType: 'Organization', entityId: ctx.org.id, before: { coverage: settings.coverage ?? null }, after: { coverage } })
    refresh()
  })
}

export async function saveFlagsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const before = await db.featureFlag.findMany({ where: { orgId: ctx.org.id } })
    const after = FEATURE_FLAGS.map((key) => ({ key, enabled: fdBool(form, 'flag:' + key) }))
    await db.$transaction(after.map((f) => db.featureFlag.upsert({ where: { orgId_key: { orgId: ctx.org.id, key: f.key } }, create: { orgId: ctx.org.id, ...f }, update: { enabled: f.enabled } })))
    await audit(ctx, { action: 'admin.config.feature_flags', entityType: 'FeatureFlag', before: before.map(({ key, enabled }) => ({ key, enabled })), after })
    refresh()
  })
}
