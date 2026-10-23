import 'server-only'
import { db } from '@/lib/db'
import { addDays, fmtDayMonth, hm, startOfDay } from '@/lib/time'
import { abnormalKeys, LIVE, mergeLimits } from '@/lib/vitals'
import { visitSince } from '@/lib/visit'
import { confirmState } from '@/lib/phone-orders'
import { PENDING_CONFIRM } from '@/lib/phone-orders-server'
import { assignedWhere } from './scope'

/**
 * Ärztliche Übersicht (PRD §4.6, §60): «meine Patient/innen» mit offenen Visitenfragen, auffälligen Werten seit der
 * letzten Visite, zu visierenden telefonischen Verordnungen und anstehenden Visiten. Gemeinsam für die Startseite
 * interner Ärztinnen/Ärzte und das Ärzteportal. Der Aufrufer bestimmt die erlaubten Personen (`residentIds`).
 */
export type BoardRow = {
  id: string
  name: string
  room: string | null
  unit: string
  allergy: boolean
  questions: number
  abnormal: number
  pending: number
  overdue: number
  lastVisit: string | null
  nextVisit: string | null
}

type Base = { org: { id: string }; locale: Parameters<typeof fmtDayMonth>[1]; t: (k: string, v?: Record<string, string | number>) => string }

/** Aktuell zugeordnete Personen eines Kontos (optional auf Bereiche begrenzt). */
export async function myPatientIds(orgId: string, userId: string, unitIds?: string[], now = new Date()) {
  const rows = await db.resident.findMany({
    where: { orgId, status: { in: ['active', 'absent'] }, ...(unitIds ? { unitId: { in: unitIds } } : {}), ...assignedWhere(userId, now) },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export async function patientBoard(base: Base, residentIds: string[], now = new Date()) {
  const ids = [...new Set(residentIds)]
  const day = startOfDay(now)
  const [residents, qCounts, pending, appts, visits, doneAppts, thresholds] = await Promise.all([
    db.resident.findMany({
      where: { id: { in: ids }, orgId: base.org.id },
      select: { id: true, firstName: true, lastName: true, allergies: true, room: { select: { number: true } }, unit: { select: { name: true } } },
      orderBy: [{ unit: { name: 'asc' } }, { room: { number: 'asc' } }, { lastName: 'asc' }],
    }),
    db.visitQuestion.groupBy({ by: ['residentId'], where: { orgId: base.org.id, residentId: { in: ids }, status: 'open' }, _count: { _all: true } }),
    db.medication.findMany({ where: { residentId: { in: ids }, ...PENDING_CONFIRM }, select: { id: true, residentId: true, name: true, orderSource: true, confirmedAt: true, confirmDueAt: true, prescriber: true, createdAt: true }, orderBy: { confirmDueAt: 'asc' } }),
    db.appointment.findMany({ where: { residentId: { in: ids }, kind: 'physician', done: false, at: { gte: day, lt: addDays(day, 8) } }, orderBy: { at: 'asc' } }),
    db.visit.groupBy({ by: ['residentId'], where: { orgId: base.org.id, residentId: { in: ids } }, _max: { at: true } }),
    db.appointment.groupBy({ by: ['residentId'], where: { residentId: { in: ids }, kind: 'physician', done: true, at: { lt: day } }, _max: { at: true } }),
    db.vitalThreshold.findMany({ where: { orgId: base.org.id } }),
  ])
  const since = new Map(ids.map((id) => {
    const v = visits.find((x) => x.residentId === id)?._max.at
    const a = doneAppts.find((x) => x.residentId === id)?._max.at
    return [id, visitSince([v, a], now)] as const
  }))
  const floor = [...since.values()].reduce((m, s) => (s.since < m ? s.since : m), now)
  const vitals = ids.length ? await db.vitalSign.findMany({ where: { residentId: { in: ids }, at: { gte: floor }, ...LIVE } }) : []
  const date = (d: Date) => fmtDayMonth(d, base.locale)
  const rows: BoardRow[] = residents.map((r) => {
    const s = since.get(r.id)!
    const limits = mergeLimits(thresholds, r.id)
    const p = pending.filter((m) => m.residentId === r.id)
    const next = appts.find((a) => a.residentId === r.id)
    const last = visits.find((x) => x.residentId === r.id)?._max.at ?? null
    return {
      id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, unit: r.unit.name, allergy: r.allergies.length > 0,
      questions: qCounts.find((x) => x.residentId === r.id)?._count._all ?? 0,
      abnormal: vitals.filter((v) => v.residentId === r.id && v.at >= s.since && abnormalKeys(v, limits).length > 0).length,
      pending: p.length, overdue: p.filter((m) => confirmState(m, now) === 'overdue').length,
      lastVisit: last ? date(last) : null,
      nextVisit: next ? `${date(next.at)} ${hm(next.at)}` : null,
    }
  })
  const name = (id: string) => rows.find((x) => x.id === id)?.name ?? '–'
  return {
    rows,
    pending: pending.map((m) => ({ id: m.id, residentId: m.residentId, resident: name(m.residentId), drug: m.name, by: m.prescriber, source: m.orderSource, state: confirmState(m, now), due: m.confirmDueAt ? `${date(m.confirmDueAt)} ${hm(m.confirmDueAt)}` : '' })),
    appointments: appts.map((a) => ({ id: a.id, residentId: a.residentId, resident: name(a.residentId), title: a.title, at: `${date(a.at)} ${hm(a.at)}`, today: a.at < addDays(day, 1) })),
  }
}
