import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { overdueCount } from '@/lib/tasks'
import { runningShift, shiftTypes } from '@/lib/shift'
import { addDays, dbDate, fmtNum, hm, startOfDay } from '@/lib/time'
import { abnormalKeys, LIVE, mergeLimits, VITALS } from '@/lib/vitals'
import { runningAndPrevious } from '../handover/collect'

export type StaffingRow = { unitId: string; byCode: { code: string; n: number }[]; openToday: number; openWeek: number }

/** Besetzung heute je Bereich (Dienstplan): eingeteilte Personen je Diensttyp, offene Dienste heute und in 7 Tagen. */
export async function staffing(unitIds: string[], now: Date): Promise<StaffingRow[]> {
  const today = dbDate(now)
  const [shifts, open] = await Promise.all([
    db.shift.findMany({ where: { unitId: { in: unitIds }, date: today, status: { not: 'cancelled' } }, select: { unitId: true, userId: true, status: true, shiftType: { select: { code: true, start: true } } } }),
    db.shift.findMany({ where: { unitId: { in: unitIds }, status: 'open', date: { gte: today, lte: dbDate(addDays(now, 7)) } }, select: { unitId: true, date: true } }),
  ])
  return unitIds.map((unitId) => {
    const mine = shifts.filter((s) => s.unitId === unitId && s.userId)
    const codes = [...new Map(shifts.filter((s) => s.unitId === unitId).map((s) => [s.shiftType.code, s.shiftType.start])).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([c]) => c)
    return {
      unitId,
      byCode: codes.map((code) => ({ code, n: mine.filter((s) => s.shiftType.code === code).length })),
      openToday: open.filter((s) => s.unitId === unitId && s.date.getTime() === today.getTime()).length,
      openWeek: open.filter((s) => s.unitId === unitId).length,
    }
  })
}

export type CriticalItem = { residentId: string; unitId: string; who: string; text: string; href: string }

/**
 * Übersicht je Bereich für Leitung/PDL (PRD §4.6, §7): Bewohnende, kritische Punkte (auffällige, nicht gesehene Werte;
 * schwere oder neue Ereignisse), überfällige Aufgaben, Übergabe der Vorschicht, Zuteilung der laufenden Schicht, Besetzung.
 */
export async function unitOverview(ctx: Ctx, unitIds: string[], now: Date) {
  const { t, locale } = ctx
  const [residents, limits, incidents, types, running, staff] = await Promise.all([
    db.resident.findMany({ where: { orgId: ctx.org.id, unitId: { in: unitIds }, status: 'active' }, select: { id: true, unitId: true, firstName: true, lastName: true, room: { select: { number: true } } } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id } }),
    db.incident.findMany({ where: { orgId: ctx.org.id, unitId: { in: unitIds }, OR: [{ occurredAt: { gte: addDays(now, -1) } }, { stage: { not: 'closed' } }] }, include: { type: true }, orderBy: { occurredAt: 'desc' } }),
    shiftTypes(ctx.org.id),
    runningShift(ctx.org.id, now),
    staffing(unitIds, now),
  ])
  const rIds = residents.map((r) => r.id)
  const rById = new Map(residents.map((r) => [r.id, r]))
  const { previous } = runningAndPrevious(types, now)
  const [vitals, overdue, handovers, assigned] = await Promise.all([
    db.vitalSign.findMany({ where: { residentId: { in: rIds }, at: { gte: addDays(now, -1) }, ...LIVE }, orderBy: { at: 'desc' } }),
    Promise.all(unitIds.map((u) => (ctx.can('task.read', { unitId: u, locationId: ctx.units.find((x) => x.id === u)?.locationId }) ? overdueCount(u, now) : Promise.resolve(0)))),
    previous ? db.handover.findMany({ where: { unitId: { in: unitIds }, shiftCode: previous.def.code, date: dbDate(startOfDay(previous.start)) }, select: { unitId: true, submittedAt: true } }) : [],
    running ? db.shiftAssignment.findMany({ where: { orgId: ctx.org.id, unitId: { in: unitIds }, shiftCode: running.code, date: dbDate(startOfDay(running.from)) }, select: { unitId: true, residentId: true }, distinct: ['residentId'] }) : [],
  ])
  const who = (id: string) => {
    const r = rById.get(id)
    return r ? `${r.lastName} ${r.firstName}${r.room ? ' · ' + r.room.number : ''}` : ''
  }
  const critical: CriticalItem[] = []
  const seen = new Set<string>()
  for (const v of vitals) {
    if (seen.has(v.residentId)) continue
    seen.add(v.residentId)
    const ab = abnormalKeys(v, mergeLimits(limits, v.residentId))
    const r = rById.get(v.residentId)
    if (!r || !ab.length || v.reviewedAt) continue
    critical.push({ residentId: r.id, unitId: r.unitId, who: who(r.id), href: `/residents/${r.id}/vitals`, text: ab.map((k) => t('home.abnormalVital', { label: t('common.vitals.' + k), value: fmtNum(v[k] as number, VITALS[k].dec, locale) + ' ' + VITALS[k].unit })).join(' · ') + ' · ' + hm(v.at) })
  }
  for (const i of incidents) {
    if (i.occurredAt < addDays(now, -1) || !(i.severity === 'severe' || i.severity === 'moderate' || i.stage === 'reported')) continue
    critical.push({ residentId: i.residentId ?? '', unitId: i.unitId, who: i.residentId ? who(i.residentId) : '', href: `/quality/${i.id}`, text: t('home.incidentToday', { type: i.type.name }) })
  }
  const rows = unitIds.map((unitId, idx) => {
    const unit = ctx.units.find((u) => u.id === unitId)!
    const total = residents.filter((r) => r.unitId === unitId).length
    const ho = handovers.find((h) => h.unitId === unitId)
    return {
      unit: { id: unit.id, name: unit.name, location: unit.location.name },
      residents: total,
      critical: critical.filter((c) => c.unitId === unitId).length,
      overdue: overdue[idx],
      handover: previous ? { shift: previous.def, submittedAt: ho?.submittedAt ?? null } : null,
      assigned: running ? { shift: running, n: assigned.filter((a) => a.unitId === unitId).length, total } : null,
      staffing: staff.find((s) => s.unitId === unitId)!,
      incidentsOpen: incidents.filter((i) => i.unitId === unitId && i.stage !== 'closed').length,
    }
  })
  return { rows, critical, openIncidents: incidents.filter((i) => i.stage !== 'closed') }
}

/** Entscheidungen der Leitung: Abwesenheitsanträge, Tauschfreigaben, eingereichte Pflegeplanungen. */
export async function leadDecisions(ctx: Ctx, unitIds: string[], now: Date) {
  const canSchedule = unitIds.some((u) => ctx.can('schedule.manage', { unitId: u, locationId: ctx.units.find((x) => x.id === u)?.locationId }))
  const canApprove = unitIds.some((u) => ctx.can('resident.careplan.approve', { unitId: u, locationId: ctx.units.find((x) => x.id === u)?.locationId }))
  const staffIds = canSchedule
    ? [...new Set((await db.shift.findMany({ where: { unitId: { in: unitIds }, userId: { not: null }, date: { gte: dbDate(addDays(now, -30)), lte: dbDate(addDays(now, 60)) } }, select: { userId: true }, distinct: ['userId'] })).map((s) => s.userId!))].filter((id) => id !== ctx.user.id)
    : []
  const [absences, swaps, drafts] = await Promise.all([
    canSchedule ? db.absence.count({ where: { userId: { in: staffIds }, status: 'requested' } }) : 0,
    canSchedule ? db.swapRequest.count({ where: { status: 'requested', acceptedAt: { not: null }, shift: { unitId: { in: unitIds }, status: 'swap_requested' } } }) : 0,
    canApprove ? db.carePlan.findMany({ where: { status: 'draft', resident: { orgId: ctx.org.id, unitId: { in: unitIds }, status: { in: ['active', 'absent'] } } }, select: { id: true } }) : [],
  ])
  const submitted = drafts.length
    ? await db.auditLog.findMany({ where: { orgId: ctx.org.id, entityType: 'CarePlan', entityId: { in: drafts.map((d) => d.id) }, action: 'careplan.submit' }, select: { entityId: true }, distinct: ['entityId'] })
    : []
  return { canSchedule, canApprove, absences, swaps, plans: submitted.length }
}
