import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, startOfDay } from '@/lib/time'
import { weekStart } from '@/lib/therapy'

/** Bereiche, in denen die Person Therapiepläne sieht. */
export const therapyUnitIds = (ctx: Ctx) => ctx.units.filter((u) => ctx.can('therapy.read', { unitId: u.id, locationId: u.locationId })).map((u) => u.id)

/** Arbeitsliste Therapie: Einheiten heute, aktive Pläne mit Wochenstand, Aufträge aus der Visite, Berichte (7 Tage). */
export async function therapyBoard(ctx: Ctx, unitIds: string[], now = new Date()) {
  const day = startOfDay(now)
  const residents = await db.resident.findMany({
    where: { orgId: ctx.org.id, unitId: { in: unitIds }, status: { in: ['active', 'absent'] } },
    select: { id: true, firstName: true, lastName: true, unitId: true, allergies: true, room: { select: { number: true } }, unit: { select: { name: true } } },
    orderBy: [{ unit: { name: 'asc' } }, { room: { number: 'asc' } }, { lastName: 'asc' }],
  })
  const ids = residents.map((r) => r.id)
  const [plans, today, upcoming, reports, orders] = await Promise.all([
    db.therapyPlan.findMany({ where: { orgId: ctx.org.id, residentId: { in: ids }, status: 'active' }, orderBy: [{ reviewAt: 'asc' }, { createdAt: 'asc' }] }),
    db.appointment.findMany({ where: { residentId: { in: ids }, kind: 'therapy', at: { gte: day, lt: addDays(day, 1) } }, orderBy: { at: 'asc' } }),
    db.appointment.findMany({ where: { residentId: { in: ids }, kind: 'therapy', done: false, at: { gte: now, lt: addDays(day, 15) }, therapyPlanId: { not: null } }, orderBy: { at: 'asc' } }),
    db.observation.findMany({ where: { residentId: { in: ids }, category: 'therapy', at: { gte: addDays(now, -7) }, correctedBy: { none: {} } }, orderBy: { at: 'desc' }, take: 40 }),
    db.visitOrder.findMany({ where: { residentId: { in: ids }, kind: 'therapy', createdAt: { gte: addDays(now, -60) } }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ])
  const planned = new Set((await db.therapyPlan.findMany({ where: { orgId: ctx.org.id, orderId: { in: orders.map((o) => o.id) } }, select: { orderId: true } })).map((p) => p.orderId))
  const week = weekStart(now)
  const weekReports = await db.observation.findMany({ where: { residentId: { in: ids }, category: 'therapy', at: { gte: week } }, select: { at: true, structured: true } })
  const sessionsOf = (planId: string) => weekReports.filter((o) => {
    const s = o.structured as { planId?: string; outcome?: string } | null
    return s?.planId === planId && s.outcome === 'done'
  }).map((o) => o.at)
  const rOf = (id: string) => residents.find((r) => r.id === id)
  return { residents, plans, today, upcoming, reports, orders: orders.filter((o) => !planned.has(o.id)), sessionsOf, rOf }
}
