import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { fmtDayMonth } from '@/lib/time'
import { doseText } from '@/components/meds/dose'
import { listShort, medChanges, planDiff, schedule } from '@/lib/shift-changes'

export type OrderChange = { residentId: string; at: Date; kind: 'medication' | 'careplan'; text: string; by: string | null }

const short = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 2).trimEnd() + ' …' : s)

/**
 * Neue, geänderte und abgesetzte Verordnungen sowie freigegebene Pflegeplan-Versionen im Zeitfenster (PRD §11.1).
 * Gemeinsam für Übergabe («Was ist passiert?») und Home («Seit deinem letzten Dienst»).
 * Verordnungen nur mit `resident.medication.read` (`meds`), Pflegeplanung mit Leseberechtigung der Akte.
 */
export async function orderAndPlanChanges(ctx: Ctx, rIds: string[], from: Date, until: Date, opts: { meds: boolean }): Promise<OrderChange[]> {
  const { t, locale } = ctx
  if (!rIds.length || until <= from) return []
  const [started, stopped, plans] = await Promise.all([
    opts.meds ? db.medication.findMany({ where: { residentId: { in: rIds }, createdAt: { gte: from, lt: until } } }) : [],
    opts.meds ? db.medication.findMany({ where: { residentId: { in: rIds }, stoppedAt: { gte: from, lt: until } } }) : [],
    db.carePlan.findMany({
      where: { residentId: { in: rIds }, approvedAt: { gte: from, lt: until } },
      include: { areas: { include: { interventions: true } } },
      orderBy: { approvedAt: 'asc' },
    }),
  ])
  const medIds = [...started, ...stopped].map((m) => m.id)
  const [logs, prevPlans] = await Promise.all([
    medIds.length
      ? db.auditLog.findMany({
          where: { orgId: ctx.org.id, entityType: 'Medication', entityId: { in: medIds }, action: { in: ['medication.order.change', 'medication.order.create', 'medication.order.stop'] } },
          select: { action: true, entityId: true, context: true },
        })
      : [],
    plans.length
      ? db.carePlan.findMany({
          where: { residentId: { in: [...new Set(plans.map((p) => p.residentId))] }, approvedAt: { not: null } },
          include: { areas: { include: { interventions: true } } },
          orderBy: { version: 'desc' },
        })
      : [],
  ])
  const userIds = [...new Set([...started.map((m) => m.createdById), ...stopped.map((m) => m.stoppedById), ...plans.map((p) => p.approvedById)].filter((x): x is string => !!x))]
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds }, orgId: ctx.org.id }, select: { id: true, initials: true } }) : []
  const ini = (id: string | null | undefined) => (id ? users.find((u) => u.id === id)?.initials ?? null : null)

  const replaces = new Map<string, string>()
  const reason = new Map<string, string>()
  for (const l of logs) {
    const c = (l.context ?? {}) as { replaces?: string; reason?: string }
    if (l.action === 'medication.order.change' && l.entityId && c.replaces) {
      replaces.set(l.entityId, c.replaces)
      if (c.reason) reason.set(l.entityId, c.reason)
    }
    if (l.action === 'medication.order.stop' && l.entityId && c.reason) reason.set(l.entityId, c.reason)
  }
  const sched = (m: Parameters<typeof schedule>[0]) => schedule(m, (d, f) => doseText(d, f), t('home.chg.prn'))
  const why = (id: string) => (reason.get(id) ? ' · ' + t('home.chg.reason', { reason: short(reason.get(id)!) }) : '')

  const out: OrderChange[] = []
  for (const c of medChanges(started, stopped, replaces)) {
    // Beginn erst nach dem Zeitfenster (z. B. ab morgen): Datum nennen
    const later = c.type !== 'stopped' && c.med.startDate > until ? ' · ' + t('home.chg.from', { date: fmtDayMonth(c.med.startDate, locale) }) : ''
    if (c.type === 'changed') {
      const a = sched(c.old)
      const b = sched(c.med)
      const name = c.old.name === c.med.name ? c.med.name : `${c.old.name} → ${c.med.name}`
      out.push({ residentId: c.residentId, at: c.at, kind: 'medication', by: ini(c.med.createdById), text: t('home.medChanged', { name }) + (a !== b ? ` (${a} → ${b})` : '') + later + why(c.med.id) })
    } else if (c.type === 'started') {
      out.push({ residentId: c.residentId, at: c.at, kind: 'medication', by: ini(c.med.createdById), text: t('home.medStarted', { name: c.med.name }) + ` (${sched(c.med)})` + later })
    } else {
      out.push({ residentId: c.residentId, at: c.at, kind: 'medication', by: ini(c.med.stoppedById), text: t('home.medStopped', { name: c.med.name }) + why(c.med.id) })
    }
  }
  for (const p of plans) {
    const prev = prevPlans.find((x) => x.residentId === p.residentId && x.version < p.version)
    const next = p.areas.flatMap((a) => a.interventions)
    let text = t('home.chg.planApproved', { v: p.version })
    if (prev) {
      const d = planDiff(prev.areas.flatMap((a) => a.interventions), next)
      const parts = [
        d.added.length ? t('home.chg.planAdded', { list: listShort(d.added) }) : '',
        d.removed.length ? t('home.chg.planRemoved', { list: listShort(d.removed) }) : '',
        d.changed.length ? t('home.chg.planChanged', { list: listShort(d.changed) }) : '',
      ].filter(Boolean)
      text += parts.length ? ': ' + parts.join('; ') : ' · ' + t('home.chg.planNoMeasureChange')
    } else text += ' · ' + t('home.chg.planFirst', { n: next.length })
    out.push({ residentId: p.residentId, at: p.approvedAt!, kind: 'careplan', by: ini(p.approvedById), text })
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}
