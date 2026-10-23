import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { OPEN_STATUSES, overdueFilter } from '@/lib/tasks'
import { taskTitle } from '@/lib/task-title'
import { shiftTypes } from '@/lib/shift'
import { shiftName } from '@/lib/shift-name'
import { openAbsences } from '@/lib/adt'
import { addDays, dbDate, fmtNum, hm, startOfDay } from '@/lib/time'
import { abnormalKeys, LIVE, mergeLimits, VITALS } from '@/lib/vitals'
import { staffGroup, STAFF_GROUPS, type StaffGroup } from '@/lib/roster/groups'
import { readShiftPrefs } from '@/lib/roster/model'
import { runningAndPrevious } from '../../handover/collect'
import { draftFilter } from '../../schedule/lib'

export type FloorRoom = { id: string; number: string; beds: number; people: { id: string; name: string; absent: boolean; overdue: number; alert: boolean }[] }
export type FloorItem = { rid: string | null; who: string; text: string; href: string; tone: 'crit' | 'warn' | '' }
export type FloorShift = { code: string; name: string; time: string; running: boolean; staff: { name: string; group: StaffGroup }[]; open: number }

/**
 * Stockwerksübersicht (Bewohnerseite ohne gewählte Person): Belegung, Lage der Schicht, kritische Punkte,
 * Dienst heute, Termine, Abwesende und Hinweise für den ganzen Bereich. Die Personenliste steht links.
 */
export async function floorOverview(ctx: Ctx, unitIds: string[], now: Date) {
  const { t, locale } = ctx
  const scope = (u: string) => ({ unitId: u, locationId: ctx.units.find((x) => x.id === u)?.locationId })
  const allowed = (perm: Parameters<Ctx['can']>[0]) => unitIds.filter((u) => ctx.can(perm, scope(u)))
  const taskUnits = allowed('task.read')
  const scheduleUnits = allowed('schedule.read')
  const handoverUnits = allowed('handover.read')
  const day = startOfDay(now)
  const today = dbDate(now)

  const [residents, rooms, limits, types] = await Promise.all([
    db.resident.findMany({ where: { orgId: ctx.org.id, unitId: { in: unitIds }, status: { in: ['active', 'absent'] } }, include: { room: true }, orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }] }),
    db.room.findMany({ where: { unitId: { in: unitIds } }, orderBy: { number: 'asc' } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id } }),
    shiftTypes(ctx.org.id),
  ])
  const ids = residents.map((r) => r.id)
  const rById = new Map(residents.map((r) => [r.id, r]))
  const who = (id: string | null | undefined) => {
    const r = id ? rById.get(id) : null
    return r ? `${r.lastName} ${r.firstName}${r.room ? ' · ' + r.room.number : ''}` : ''
  }
  const { running, previous } = runningAndPrevious(types, now)
  const drafts = scheduleUnits.length ? await draftFilter(ctx, day, day) : { where: undefined }

  const [taskStats, overdue, vitals, incidents, shifts, appointments, visits, wounds, handovers, absences] = await Promise.all([
    taskUnits.length ? db.task.groupBy({ by: ['status'], where: { unitId: { in: taskUnits }, dueAt: { gte: day, lt: addDays(day, 1) } }, _count: true }) : [],
    taskUnits.length ? db.task.findMany({ where: { unitId: { in: taskUnits }, ...(await overdueFilter(ctx.org.id, now)) }, orderBy: { dueAt: 'asc' }, take: 200 }) : [],
    db.vitalSign.findMany({ where: { residentId: { in: ids }, ...LIVE, at: { gte: addDays(now, -1) } }, orderBy: { at: 'desc' } }),
    db.incident.findMany({ where: { orgId: ctx.org.id, unitId: { in: unitIds }, OR: [{ occurredAt: { gte: addDays(now, -1) } }, { stage: { not: 'closed' } }] }, include: { type: true }, orderBy: { occurredAt: 'desc' } }),
    scheduleUnits.length
      ? db.shift.findMany({
          where: { AND: [{ unitId: { in: scheduleUnits }, date: today, status: { not: 'cancelled' } }, drafts.where ?? {}] },
          include: { shiftType: true, user: { select: { firstName: true, lastName: true, jobTitle: true, shiftPrefs: true, qualifications: { select: { qualification: { select: { name: true, level: true } } } } } } },
        })
      : [],
    db.appointment.findMany({ where: { residentId: { in: ids }, at: { gte: day, lt: addDays(day, 1) } }, orderBy: { at: 'asc' } }),
    db.visitRequest.findMany({ where: { orgId: ctx.org.id, residentId: { in: ids }, status: { in: ['requested', 'confirmed'] }, start: { gte: day, lt: addDays(day, 1) } }, orderBy: { start: 'asc' } }),
    db.wound.findMany({ where: { residentId: { in: ids }, status: { not: 'closed' } }, select: { residentId: true, bodySite: true, kind: true } }),
    previous && handoverUnits.length ? db.handover.findMany({ where: { unitId: { in: handoverUnits }, shiftCode: previous.def.code, date: dbDate(startOfDay(previous.start)) }, select: { unitId: true, submittedAt: true, authorId: true } }) : [],
    openAbsences(residents.filter((r) => r.status === 'absent').map((r) => r.id)),
  ])

  // Massnahmen heute
  const done = taskStats.filter((s) => s.status === 'done' || s.status === 'skipped' || s.status === 'partial').reduce((n, s) => n + s._count, 0)
  const open = taskStats.filter((s) => (OPEN_STATUSES as readonly string[]).includes(s.status)).reduce((n, s) => n + s._count, 0)
  const total = taskStats.reduce((n, s) => n + s._count, 0)

  // Kritisch: auffällige, nicht gesehene Werte; überfällige Massnahmen; Ereignisse der letzten 24 Std.
  const items: FloorItem[] = []
  const latest = new Map<string, (typeof vitals)[number]>()
  for (const v of vitals) if (!latest.has(v.residentId)) latest.set(v.residentId, v)
  const alerts = new Set<string>()
  for (const [rid, v] of latest) {
    const ab = abnormalKeys(v, mergeLimits(limits.filter((l) => !l.residentId || l.residentId === rid), rid))
    if (!ab.length || v.reviewedAt) continue
    alerts.add(rid)
    items.push({ rid, who: who(rid), tone: 'crit', href: `/residents/${rid}/vitals`, text: ab.map((k) => t('home.abnormalVital', { label: t('common.vitals.' + k), value: fmtNum(v[k] as number, VITALS[k].dec, locale) + ' ' + VITALS[k].unit })).join(' · ') + ' · ' + hm(v.at) })
  }
  const overdueBy = new Map<string, number>()
  for (const k of overdue) if (k.residentId) overdueBy.set(k.residentId, (overdueBy.get(k.residentId) ?? 0) + 1)
  for (const [rid, n] of overdueBy) {
    const first = overdue.find((k) => k.residentId === rid)!
    items.push({ rid, who: who(rid), tone: 'crit', href: `/residents/${rid}/day`, text: n > 1 ? t('residents.floor.overdueMore', { title: taskTitle(t, first), time: hm(first.dueAt), n: n - 1 }) : t('home.overdueTask', { title: taskTitle(t, first), time: hm(first.dueAt) }) })
  }
  const unassigned = overdue.filter((k) => !k.residentId).length
  if (unassigned) items.push({ rid: null, who: t('residents.floor.unitTasks'), tone: 'crit', href: '/tasks', text: t('residents.unit.overdueN', { n: unassigned }) })
  for (const i of incidents) {
    if (i.occurredAt < addDays(now, -1)) continue
    const serious = i.severity === 'severe' || i.severity === 'moderate' || i.stage === 'reported'
    items.push({ rid: i.residentId, who: who(i.residentId) || t('residents.floor.unit'), tone: serious ? 'crit' : 'warn', href: ctx.can('quality.report') ? `/quality/${i.id}` : i.residentId ? `/residents/${i.residentId}` : '/quality', text: t('home.incidentToday', { type: i.type.name }) + ' · ' + hm(i.occurredAt) })
  }
  // pro Person gebündelt, Personen mit mehreren Punkten zuerst
  const order = new Map<string, number>()
  for (const i of items) order.set(i.rid ?? i.who, (order.get(i.rid ?? i.who) ?? 0) + 1)
  items.sort((a, b) => (order.get(b.rid ?? b.who) ?? 0) - (order.get(a.rid ?? a.who) ?? 0) || (a.who).localeCompare(b.who, 'de'))

  // Zimmerbelegung
  const floorRooms: FloorRoom[] = rooms.map((room) => ({
    id: room.id,
    number: room.number,
    beds: room.beds,
    people: residents.filter((r) => r.roomId === room.id).map((r) => ({ id: r.id, name: `${r.lastName} ${r.firstName.charAt(0)}.`, absent: r.status === 'absent', overdue: overdueBy.get(r.id) ?? 0, alert: alerts.has(r.id) })),
  }))
  const beds = rooms.reduce((n, r) => n + r.beds, 0)
  const occupied = floorRooms.reduce((n, r) => n + Math.min(r.people.length, r.beds), 0)
  const withoutRoom = residents.filter((r) => !r.roomId)

  // Dienst heute je Dienstart (Reihenfolge nach Beginn)
  const byType = new Map<string, FloorShift>()
  for (const s of [...shifts].sort((a, b) => a.shiftType.start.localeCompare(b.shiftType.start))) {
    const code = s.shiftType.code
    if (!byType.has(code)) byType.set(code, { code, name: shiftName(t, s.shiftType), time: `${s.shiftType.start}–${s.shiftType.end}`, running: running?.def.code === code, staff: [], open: 0 })
    const row = byType.get(code)!
    if (s.status === 'open' || !s.user) { row.open++; continue }
    const q = s.user.qualifications.map((x) => x.qualification).sort((a, b) => b.level - a.level)[0]
    const group = readShiftPrefs(s.user.shiftPrefs, []).group ?? staffGroup(q?.name ?? '', s.user.jobTitle ?? '').group
    row.staff.push({ name: `${s.user.firstName} ${s.user.lastName}`, group })
  }
  for (const row of byType.values()) row.staff.sort((a, b) => STAFF_GROUPS.indexOf(a.group) - STAFF_GROUPS.indexOf(b.group) || a.name.localeCompare(b.name, 'de'))

  // Übergabe der Vorschicht
  const ho = previous && handoverUnits.length
    ? { shift: shiftName(t, previous.def), submitted: handovers.filter((h) => h.submittedAt).length, units: handoverUnits.length, at: handovers.map((h) => h.submittedAt).filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null }
    : null

  // Hinweise
  const active = residents.filter((r) => r.status === 'active')
  const risks = new Map<string, string[]>()
  for (const r of residents) for (const x of r.risks) risks.set(x, [...(risks.get(x) ?? []), r.id])
  const woundBy = new Map<string, string[]>()
  for (const w of wounds) woundBy.set(w.residentId, [...(woundBy.get(w.residentId) ?? []), w.bodySite])
  const levels = residents.map((r) => r.careLevel).filter((x): x is number => x != null)
  const recent = residents.filter((r) => r.admittedAt >= addDays(now, -14)).sort((a, b) => b.admittedAt.getTime() - a.admittedAt.getTime())

  return {
    counts: { residents: residents.length, active: active.length, absent: residents.length - active.length, beds, occupied, freeBeds: Math.max(0, beds - occupied), roomsFree: floorRooms.filter((r) => r.people.length === 0).length },
    tasks: taskUnits.length ? { total, done, open, overdue: overdue.length } : null,
    alerts: alerts.size,
    incidentsOpen: incidents.filter((i) => i.stage !== 'closed').length,
    careLevel: levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : null,
    items,
    rooms: floorRooms,
    withoutRoom: withoutRoom.map((r) => ({ id: r.id, name: `${r.lastName} ${r.firstName}`, absent: r.status === 'absent' })),
    shifts: scheduleUnits.length ? [...byType.values()] : null,
    handover: ho,
    agenda: [
      ...appointments.map((a) => ({ key: 'a' + a.id, at: a.at, who: who(a.residentId), text: a.title + (a.place ? ' · ' + a.place : ''), done: a.done, href: `/residents/${a.residentId}` })),
      ...visits.map((v) => ({ key: 'v' + v.id, at: v.start, who: who(v.residentId), text: t('residents.floor.visit', { n: v.visitors }) + (v.visitorName ? ' · ' + v.visitorName : '') + (v.status === 'requested' ? ' · ' + t('residents.floor.visitRequested') : ''), done: false, href: `/residents/${v.residentId}` })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime()),
    absent: residents.filter((r) => r.status === 'absent').map((r) => ({ id: r.id, who: who(r.id), since: absences.get(r.id)?.start ?? null, reason: absences.get(r.id)?.reason ?? null, back: absences.get(r.id)?.expectedEnd ?? null })),
    notes: {
      reaNo: residents.filter((r) => r.rea === 'no').map((r) => ({ id: r.id, who: who(r.id) })),
      allergies: residents.filter((r) => r.allergies.length).map((r) => ({ id: r.id, who: who(r.id), text: r.allergies.join(', ') })),
      risks: [...risks.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'de')).map(([name, rids]) => ({ name, people: rids.map((id) => ({ id, who: who(id) })) })),
      wounds: [...woundBy.entries()].map(([id, sites]) => ({ id, who: who(id), text: sites.join(', ') })),
      recent: recent.map((r) => ({ id: r.id, who: who(r.id), at: r.admittedAt })),
    },
  }
}

export type Floor = Awaited<ReturnType<typeof floorOverview>>
