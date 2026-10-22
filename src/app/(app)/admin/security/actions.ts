'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { DATA_CATEGORIES, INCIDENT_KINDS as KINDS, INCIDENT_RISKS as RISKS, INCIDENT_STATUS as STATUS, parseDateTimeInput } from './parse'
import { securityThresholds, type Thresholds } from '@/lib/security-rules'

async function guard() {
  const ctx = await getCtx()
  assertCan(ctx, 'admin.audit')
  return ctx
}

const ALERT_STATUS = ['open', 'acknowledged', 'resolved', 'false_positive'] as const

/** Alarm bearbeiten: Status und Notiz (Abklärung). */
export async function setAlertStatusAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await guard()
    const id = fd(form, 'id')
    const status = z.enum(ALERT_STATUS).parse(fd(form, 'status'))
    const note = fd(form, 'note')
    if (note.length > 1000) return { ok: false, error: 'platform.security.errors.note', field: 'note' }
    const before = await db.securityAlert.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!before) return { ok: false, error: 'common.notFound' }
    const after = await db.securityAlert.update({
      where: { id },
      data: { status, note: note || before.note, handledById: status === 'open' ? null : ctx.user.id, handledAt: status === 'open' ? null : new Date() },
    })
    await audit(ctx, { action: 'security.alert.status', entityType: 'SecurityAlert', entityId: id, before: { status: before.status, note: before.note }, after: { status: after.status, note: after.note } })
    refresh()
    return { ok: true, message: 'platform.security.saved' }
  })
}

/** Schnellaktion ohne Dialog (In Bearbeitung, Wieder öffnen). */
export async function quickAlertStatusAction(id: string, status: (typeof ALERT_STATUS)[number]): Promise<ActionResult> {
  const f = new FormData()
  f.set('id', id)
  f.set('status', status)
  return setAlertStatusAction(f)
}

const PAIRS = ['loginUser', 'loginIp', 'mfa', 'massAccess', 'residentExports', 'api'] as const

export async function saveThresholdsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await guard()
    const raw: Record<string, unknown> = {}
    for (const k of PAIRS) {
      const a = Number(fd(form, k + '.warn'))
      const b = Number(fd(form, k + '.crit'))
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 2 || b <= a || b > 100_000) return { ok: false, error: 'platform.security.errors.thresholds', field: k + '.crit' }
      raw[k] = [a, b]
    }
    const burst = Number(fd(form, 'permissionBurst'))
    if (!Number.isInteger(burst) || burst < 2 || burst > 10_000) return { ok: false, error: 'platform.security.errors.thresholds', field: 'permissionBurst' }
    raw.permissionBurst = burst
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const settings = (org.settings && typeof org.settings === 'object' && !Array.isArray(org.settings) ? org.settings : {}) as Record<string, unknown>
    const before: Thresholds = securityThresholds(settings)
    const after: Thresholds = securityThresholds({ security: { thresholds: raw } })
    const security = { ...((settings.security as Record<string, unknown>) ?? {}), thresholds: after }
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...settings, security } as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'admin.security.thresholds', entityType: 'Organization', entityId: ctx.org.id, before, after })
    refresh()
    return { ok: true, message: 'platform.security.saved' }
  })
}

// ───────── Vorfallregister (PRD §36) ─────────

const tri = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null)

const incidentSchema = z.object({
  title: z.string().trim().min(3, 'platform.incidents.errors.title').max(160, 'platform.incidents.errors.title'),
  kind: z.enum(KINDS),
  description: z.string().trim().min(10, 'platform.incidents.errors.description').max(5000),
  risk: z.enum(RISKS),
  status: z.enum(STATUS),
  measures: z.string().trim().max(5000),
  affectedCount: z.union([z.literal(''), z.coerce.number().int().min(0).max(10_000_000)]),
})

export async function saveIncidentAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await guard()
    const id = fd(form, 'id')
    const input = incidentSchema.parse({
      title: fd(form, 'title'), kind: fd(form, 'kind'), description: fd(form, 'description'), risk: fd(form, 'risk') || 'medium',
      status: fd(form, 'status') || 'open', measures: fd(form, 'measures'), affectedCount: fd(form, 'affectedCount'),
    })
    const now = new Date()
    const discoveredAt = parseDateTimeInput(fd(form, 'discoveredAt'))
    if (!discoveredAt) return { ok: false, error: 'platform.incidents.errors.discoveredAt', field: 'discoveredAt' }
    if (discoveredAt.getTime() > now.getTime() + 5 * 60_000) return { ok: false, error: 'platform.incidents.errors.future', field: 'discoveredAt' }
    const occurredAt = fd(form, 'occurredAt') ? parseDateTimeInput(fd(form, 'occurredAt')) : null
    if (occurredAt && occurredAt > discoveredAt) return { ok: false, error: 'platform.incidents.errors.order', field: 'occurredAt' }
    const authorityNotifiedAt = parseDateTimeInput(fd(form, 'authorityNotifiedAt'))
    const subjectsNotifiedAt = parseDateTimeInput(fd(form, 'subjectsNotifiedAt'))
    for (const [k, d] of [['authorityNotifiedAt', authorityNotifiedAt], ['subjectsNotifiedAt', subjectsNotifiedAt]] as const) {
      if (d && d.getTime() > now.getTime() + 5 * 60_000) return { ok: false, error: 'platform.incidents.errors.future', field: k }
    }
    const data = {
      title: input.title,
      kind: input.kind,
      description: input.description,
      risk: input.risk,
      status: input.status,
      measures: input.measures || null,
      affectedCount: input.affectedCount === '' ? null : input.affectedCount,
      dataCategories: DATA_CATEGORIES.filter((c) => form.getAll('dataCategories').includes(c)),
      discoveredAt,
      occurredAt,
      authorityRequired: tri(fd(form, 'authorityRequired')),
      authorityNotifiedAt,
      subjectsRequired: tri(fd(form, 'subjectsRequired')),
      subjectsNotifiedAt,
      closedAt: input.status === 'closed' ? now : null,
    }
    if (id) {
      const before = await db.securityIncident.findFirst({ where: { id, orgId: ctx.org.id } })
      if (!before) return { ok: false, error: 'common.notFound' }
      const after = await db.securityIncident.update({ where: { id }, data: { ...data, closedAt: input.status === 'closed' ? before.closedAt ?? now : null } })
      await audit(ctx, { action: 'security.incident.update', entityType: 'SecurityIncident', entityId: id, before: snapshot(before), after: snapshot(after) })
      refresh()
      return { ok: true, message: 'platform.incidents.saved' }
    }
    // Fortlaufende Nummer je Organisation; bei gleichzeitiger Erfassung erneut versuchen (Unique-Schlüssel).
    const alertId = fd(form, 'alertId')
    for (let attempt = 0; attempt < 3; attempt++) {
      const last = await db.securityIncident.findFirst({ where: { orgId: ctx.org.id }, orderBy: { number: 'desc' }, select: { number: true } })
      try {
        const row = await db.securityIncident.create({ data: { ...data, orgId: ctx.org.id, number: (last?.number ?? 0) + 1, reportedById: ctx.user.id } })
        if (alertId) {
          await db.securityAlert.updateMany({ where: { id: alertId, orgId: ctx.org.id }, data: { incidentId: row.id, status: 'acknowledged', handledById: ctx.user.id, handledAt: now } })
        }
        await audit(ctx, { action: 'security.incident.create', entityType: 'SecurityIncident', entityId: row.id, after: snapshot(row), context: alertId ? { alertId } : undefined })
        refresh()
        return { ok: true, message: 'platform.incidents.created' }
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002' || attempt === 2) throw e
      }
    }
  })
}

const snapshot = (r: { number: number; title: string; kind: string; risk: string; status: string; dataCategories: string[]; affectedCount: number | null; discoveredAt: Date; authorityRequired: boolean | null; authorityNotifiedAt: Date | null; subjectsRequired: boolean | null; subjectsNotifiedAt: Date | null }) => ({
  number: r.number, title: r.title, kind: r.kind, risk: r.risk, status: r.status, dataCategories: r.dataCategories, affectedCount: r.affectedCount,
  discoveredAt: r.discoveredAt, authorityRequired: r.authorityRequired, authorityNotifiedAt: r.authorityNotifiedAt, subjectsRequired: r.subjectsRequired, subjectsNotifiedAt: r.subjectsNotifiedAt,
})
