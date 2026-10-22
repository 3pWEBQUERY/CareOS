import 'server-only'
import { db } from '@/lib/db'
import { addDays, dbDate, fromDbDate, shiftBounds } from '@/lib/time'
import type { DutyState } from '@/lib/notify-prefs'

/** Übergabe-Überlappung: kurz vor Dienstbeginn und kurz nach Dienstende gilt eine Person als im Dienst. */
export const DUTY_GRACE_MIN = 15

/**
 * Dienststatus für die Empfängerauswahl (src/lib/notify-prefs.ts). Liest Dienste von gestern und heute
 * (Nachtdienst über Mitternacht), Dienstplanung ±14 Tage und genehmigte Abwesenheiten.
 * unitId optional: ohne Bereich zählt nur «im Dienst irgendwo» (onDutyUnit = alle laufenden Dienste).
 */
export async function dutyState(orgId: string, userIds: string[], unitId: string | null, now = new Date()): Promise<DutyState> {
  const ids = [...new Set(userIds)]
  const unit = unitId ? await db.unit.findFirst({ where: { id: unitId, orgId }, select: { id: true, locationId: true } }) : null
  const today = dbDate(now)
  const [shifts, plannedRows, absences, leads] = await Promise.all([
    db.shift.findMany({
      where: { userId: { in: ids }, date: { in: [dbDate(addDays(now, -1)), today] }, status: { not: 'cancelled' }, unit: { orgId } },
      select: { userId: true, unitId: true, date: true, unit: { select: { locationId: true } }, shiftType: { select: { code: true, name: true, start: true, end: true } } },
    }),
    db.shift.groupBy({ by: ['userId'], where: { userId: { in: ids }, date: { gte: dbDate(addDays(now, -14)), lte: dbDate(addDays(now, 14)) }, unit: { orgId } } }),
    db.absence.findMany({ where: { userId: { in: ids }, status: 'approved', from: { lte: today }, to: { gte: today } }, select: { userId: true } }),
    unit ? leadsOf(orgId, unit.id, unit.locationId) : Promise.resolve([] as string[]),
  ])
  const grace = DUTY_GRACE_MIN * 60_000
  const onDutyUnit = new Set<string>()
  const onDutyNearby = new Set<string>()
  for (const s of shifts) {
    if (!s.userId) continue
    const b = shiftBounds(s.shiftType, fromDbDate(s.date))
    if (now.getTime() < b.start.getTime() - grace || now.getTime() > b.end.getTime() + grace) continue
    if (!unit || s.unitId === unit.id) onDutyUnit.add(s.userId)
    else if (s.unit.locationId === unit.locationId) onDutyNearby.add(s.userId)
  }
  return {
    onDutyUnit,
    onDutyNearby,
    planned: new Set(plannedRows.map((r) => r.userId).filter((x): x is string => !!x)),
    absent: new Set(absences.map((a) => a.userId)),
    leads,
  }
}

/** Bereichsleitung: aktive Personen mit schedule.manage für den Bereich (Bereich, Standort oder organisationsweit). */
async function leadsOf(orgId: string, unitId: string, locationId: string) {
  const rows = await db.roleAssignment.findMany({
    where: { role: { orgId, permissions: { has: 'schedule.manage' } }, user: { active: true }, OR: [{ unitId }, { locationId }, { unitId: null, locationId: null }] },
    select: { userId: true, unitId: true },
  })
  // Bereichs- vor Standort-/Organisationsrollen (Stationsleitung vor PDL)
  const direct = rows.filter((r) => r.unitId === unitId).map((r) => r.userId)
  return [...new Set(direct.length ? direct : rows.map((r) => r.userId))]
}

/** Bereich aus dem Link der Benachrichtigung (Akte, Ereignis) – für Aufrufer, die keinen Bereich mitgeben. */
export async function unitFromHref(orgId: string, href?: string | null) {
  if (!href) return null
  const res = /^\/residents\/([\w-]+)/.exec(href)
  if (res) return (await db.resident.findFirst({ where: { id: res[1], orgId }, select: { unitId: true } }))?.unitId ?? null
  const inc = /^\/quality\/([\w-]+)/.exec(href)
  if (inc && inc[1] !== 'new') return (await db.incident.findFirst({ where: { id: inc[1], orgId }, select: { unitId: true } }).catch(() => null))?.unitId ?? null
  return null
}
