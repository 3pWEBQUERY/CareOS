import 'server-only'
import { db } from '@/lib/db'
import { auditSystem } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notifyT } from '@/lib/notify-t'
import { hm } from '@/lib/time'
import { escalationPolicy, escalationWindow, shouldEscalateTask, overdueThreshold, ESCALATION_LOOKBACK_HOURS } from '@/lib/escalation-policy'
import { runWorkflowRules } from '@/lib/workflows'
import { reconcileIncidentActions } from '@/lib/tasks'

/**
 * Eskalationsregeln (PRD §45 Workflow – Eskalationen). Läuft alle 5 Minuten als Hintergrundjob.
 * Idempotent: jede Aufgabe wird höchstens einmal automatisch eskaliert (Audit "task.escalate"),
 * jeder wichtige Übergabeeintrag höchstens einmal pro Fassung (Audit "handover.escalate"),
 * Vitalwert- und Ereignismeldungen werden über einen Cursor auf die Domain Events genau einmal verarbeitet.
 * Überfällige Docs-Freigaben und Visitenfragen werden je einmal gemeldet (Merker reviewEscalatedAt bzw. escalatedAt).
 */

/** Aktive Benutzer mit einer der Rollen (Role.key), deren Geltungsbereich den Bereich umfasst. */
export async function usersWithRoles(orgId: string, roleKeys: string[], unitId?: string | null) {
  if (!roleKeys.length) return []
  const unit = unitId ? await db.unit.findUnique({ where: { id: unitId }, select: { locationId: true } }) : null
  const rows = await db.roleAssignment.findMany({
    where: { role: { orgId, key: { in: roleKeys } }, user: { active: true, orgId } },
    select: { userId: true, unitId: true, locationId: true },
  })
  return [
    ...new Set(
      rows
        .filter((r) => !unitId || (!r.unitId && !r.locationId) || r.unitId === unitId || (unit && r.locationId === unit.locationId))
        .map((r) => r.userId),
    ),
  ]
}

const OPEN = ['planned', 'ready', 'in_progress'] as const
type Summary = { tasks: number; handovers: number; vitals: number; incidents: number; notified: number; workflowTasks?: number; workflowClosed?: number; incidentActions?: number }

const who = (r: { firstName: string; lastName: string; room: { number: string } | null } | null) => (r ? `${r.lastName} ${r.firstName}${r.room ? ' (' + r.room.number + ')' : ''}` : '')

async function escalateTasks(org: { id: string; settings: unknown }, now: Date, s: Summary) {
  const p = escalationPolicy(org.settings)
  if (!p.enabled) return
  const { from, to } = escalationWindow(p, now)
  const tasks = await db.task.findMany({
    where: { orgId: org.id, status: { in: [...OPEN] }, dueAt: { gte: from, lte: to } },
    include: { resident: { select: { firstName: true, lastName: true, status: true, room: { select: { number: true } } } }, unit: { select: { name: true } } },
    orderBy: { dueAt: 'asc' },
  })
  const due = tasks.filter((t) => shouldEscalateTask(t, p, now) && (!t.resident || t.resident.status === 'active' || t.resident.status === 'absent'))
  if (!due.length) return
  const prior = new Set(
    (await db.auditLog.findMany({ where: { entityType: 'Task', entityId: { in: due.map((t) => t.id) }, action: 'task.escalate' }, select: { entityId: true } })).map((a) => a.entityId),
  )
  const byUnit = new Map<string, { unit: string; items: string[] }>()
  for (const t of due) {
    if (prior.has(t.id)) continue
    const upd = await db.task.updateMany({ where: { id: t.id, status: { in: [...OPEN] } }, data: { status: 'escalated' } })
    if (!upd.count) continue
    const overdueMin = Math.round((now.getTime() - t.dueAt.getTime()) / 60_000)
    await auditSystem({
      orgId: org.id, action: 'task.escalate', entityType: 'Task', entityId: t.id,
      before: { status: t.status }, after: { status: 'escalated' },
      context: { residentId: t.residentId, auto: true, priority: t.priority, overdueMin, thresholdMin: overdueThreshold(t.priority, p) },
    })
    await emit({ orgId: org.id, type: 'task.escalated', unitId: t.unitId, residentId: t.residentId, payload: { taskId: t.id, auto: true } })
    s.tasks++
    const g = byUnit.get(t.unitId) ?? { unit: t.unit.name, items: [] }
    g.items.push(`${hm(t.dueAt)} ${who(t.resident)}`.trim())
    byUnit.set(t.unitId, g)
  }
  for (const [unitId, g] of byUnit) {
    const users = await usersWithRoles(org.id, p.taskNotifyRoles, unitId)
    s.notified += users.length
    await notifyT({
      orgId: org.id, userIds: users, priority: 'critical', kind: 'task.escalated',
      titleKey: 'admin.escalation.notify.tasksTitle', bodyKey: 'admin.escalation.notify.tasksBody',
      vars: { n: g.items.length, unit: g.unit, list: g.items.slice(0, 6).join(' · ') + (g.items.length > 6 ? ' …' : '') },
      href: '/tasks', groupKey: 'task-esc-unit:' + unitId, unitId, // Bereich für dienstbewusste Zustellung
    })
  }
}

async function escalateHandovers(org: { id: string; settings: unknown }, now: Date, s: Summary) {
  const p = escalationPolicy(org.settings)
  if (!p.enabled) return
  const entries = await db.handoverEntry.findMany({
    where: {
      important: true,
      updatedAt: { gte: new Date(now.getTime() - ESCALATION_LOOKBACK_HOURS * 3600_000), lte: new Date(now.getTime() - p.unackedImportantHandoverMinutes * 60_000) },
      handover: { unit: { orgId: org.id } },
      resident: { status: { in: ['active', 'absent'] } },
    },
    include: {
      handover: { select: { id: true, unitId: true, unit: { select: { name: true } } } },
      resident: { select: { firstName: true, lastName: true, room: { select: { number: true } } } },
    },
  })
  if (!entries.length) return
  const acks = await db.acknowledgement.findMany({
    where: { subjectType: 'handover', subjectId: { in: [...new Set(entries.map((e) => e.handoverId))] } },
    select: { subjectId: true, version: true },
  })
  const acked = new Set(acks.map((a) => a.subjectId + ':' + a.version))
  const open = entries.filter((e) => !acked.has(e.handoverId + ':' + e.residentId))
  if (!open.length) return
  const prior = await db.auditLog.findMany({ where: { entityType: 'HandoverEntry', entityId: { in: open.map((e) => e.id) }, action: 'handover.escalate' }, select: { entityId: true, at: true } })
  const byUnit = new Map<string, { unit: string; items: string[] }>()
  for (const e of open) {
    if (prior.some((a) => a.entityId === e.id && a.at >= e.updatedAt)) continue
    await auditSystem({
      orgId: org.id, action: 'handover.escalate', entityType: 'HandoverEntry', entityId: e.id,
      context: { residentId: e.residentId, handoverId: e.handoverId, auto: true, thresholdMin: p.unackedImportantHandoverMinutes },
    })
    s.handovers++
    const g = byUnit.get(e.handover.unitId) ?? { unit: e.handover.unit.name, items: [] }
    g.items.push(who(e.resident))
    byUnit.set(e.handover.unitId, g)
  }
  for (const [unitId, g] of byUnit) {
    const users = await usersWithRoles(org.id, p.taskNotifyRoles, unitId)
    s.notified += users.length
    await notifyT({
      orgId: org.id, userIds: users, priority: 'action', kind: 'handover.unacked',
      titleKey: 'admin.escalation.notify.handoverTitle', bodyKey: 'admin.escalation.notify.handoverBody',
      vars: { n: g.items.length, unit: g.unit, list: g.items.slice(0, 6).join(' · '), min: p.unackedImportantHandoverMinutes },
      href: '/handover', groupKey: 'handover-esc:' + unitId, unitId,
    })
  }
}

/** Neue Domain Events (abweichende Vitalwerte, schwere Ereignisse) seit dem letzten erfolgreichen Lauf. */
async function forwardEvents(orgs: { id: string; settings: unknown }[], cursor: Date, now: Date, s: Summary) {
  const events = await db.domainEvent.findMany({
    where: { orgId: { in: orgs.map((o) => o.id) }, type: { in: ['vitals.abnormal', 'incident.reported'] }, createdAt: { gt: cursor, lte: now } },
    orderBy: { createdAt: 'asc' },
    take: 500,
  })
  for (const ev of events) {
    const org = orgs.find((o) => o.id === ev.orgId)!
    const p = escalationPolicy(org.settings)
    if (!p.enabled) continue
    const payload = (ev.payload ?? {}) as Record<string, unknown>
    if (ev.type === 'vitals.abnormal' && ev.residentId) {
      const r = await db.resident.findUnique({ where: { id: ev.residentId }, select: { firstName: true, lastName: true, room: { select: { number: true } } } })
      const users = (await usersWithRoles(org.id, p.vitalsAbnormalNotifyRoles, ev.unitId)).filter((u) => u !== ev.actorId)
      if (!r || !users.length) continue
      s.vitals++
      s.notified += users.length
      // Gleicher groupKey wie die direkte Meldung beim Erfassen: keine doppelte Benachrichtigung.
      await notifyT({
        orgId: org.id, userIds: users, priority: 'critical', kind: 'vitals.abnormal',
        titleKey: 'admin.escalation.notify.vitalsTitle', bodyKey: 'admin.escalation.notify.vitalsBody', vars: { who: who(r) },
        href: `/residents/${ev.residentId}/vitals`, groupKey: `vitals:${ev.residentId}`,
      })
    }
    if (ev.type === 'incident.reported' && payload.severity === 'severe' && typeof payload.incidentId === 'string') {
      const users = (await usersWithRoles(org.id, p.incidentSevereNotifyRoles, ev.unitId)).filter((u) => u !== ev.actorId)
      if (!users.length) continue
      const unit = ev.unitId ? await db.unit.findUnique({ where: { id: ev.unitId }, select: { name: true } }) : null
      s.incidents++
      s.notified += users.length
      await notifyT({
        orgId: org.id, userIds: users, priority: 'critical', kind: 'incident.severe',
        titleKey: 'admin.escalation.notify.incidentTitle', bodyKey: 'admin.escalation.notify.incidentBody', vars: { unit: unit?.name ?? '' },
        href: `/quality/${payload.incidentId}`, groupKey: 'incident-esc:' + payload.incidentId, unitId: ev.unitId,
      })
    }
  }
  return events.length === 500 ? events[events.length - 1].createdAt : now
}

/** Ein Lauf über alle Organisationen. cursor = Ende des vorherigen erfolgreichen Laufs (für Events). */
export async function runEscalations(now = new Date(), cursor?: Date | null) {
  const s: Summary = { tasks: 0, handovers: 0, vitals: 0, incidents: 0, notified: 0 }
  const orgs = await db.organization.findMany({ select: { id: true, settings: true } })
  for (const org of orgs) {
    await escalateTasks(org, now, s)
    await escalateHandovers(org, now, s)
  }
  const floor = new Date(now.getTime() - ESCALATION_LOOKBACK_HOURS * 3600_000)
  const from = cursor ? (cursor > floor ? cursor : floor) : new Date(now.getTime() - 10 * 60_000)
  const next = await forwardEvents(orgs, from, now, s)
  // Smart Workflows (PRD §48) und Abgleich Ereignis-Massnahmen ↔ Aufgaben im selben Lauf (eine Instanz dank Advisory Lock).
  const wf = await runWorkflowRules(now)
  s.workflowTasks = wf.created
  s.workflowClosed = wf.closed
  s.incidentActions = await reconcileIncidentActions()
  // Paket Ä: telefonische/mündliche Verordnungen ohne Gegenzeichnung nach Fristablauf (src/lib/phone-orders-server.ts)
  const phoneOrders = await import('@/lib/phone-orders-server').then((m) => m.escalatePhoneOrders(now))
  // PRD §49 Escalate: überfällige Docs-Freigaben (src/lib/docs-review-server.ts) und unbeantwortete Visitenfragen (src/lib/visit-escalate.ts)
  const docReviews = await import('@/lib/docs-review-server').then((m) => m.escalateDocReviews(now))
  const visitQuestions = await import('@/lib/visit-escalate').then((m) => m.escalateVisitQuestions(now))
  return { ...s, phoneOrders, docReviews, visitQuestions, cursor: next.toISOString() }
}
