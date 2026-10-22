import 'server-only'
import { db } from '@/lib/db'
import { ensureTasksForDay, OPEN_STATUSES } from '@/lib/tasks'
import { LIVE } from '@/lib/vitals'
import { inAudience, roleKeysByUserIds } from '@/lib/audience'
import { addDays, addMinutes, dateKey, dbDate, fromDbDate, shiftBounds, startOfDay } from '@/lib/time'

/**
 * Kennzahlen für CareOS Insights (PRD §46). Alle Werte sind Aggregate über Bereiche –
 * keine Auswertung einzelner Mitarbeitender.
 */
export type Scope = { orgId: string; unitIds: string[]; days: number; now: Date }

const startOfWeek = (d: Date) => {
  const x = startOfDay(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
export const isoWeek = (d: Date) => {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  return Math.ceil(((x.getTime() - y.getTime()) / 86_400_000 + 1) / 7)
}
/** Letzte n Kalenderwochen (Mo–So), älteste zuerst. */
export function weeks(n: number, now: Date) {
  const cur = startOfWeek(now)
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(cur, -7 * (n - 1 - i))
    return { start, end: addDays(start, 7), kw: isoWeek(start) }
  })
}
export function daysBack(n: number, now: Date) {
  const today = startOfDay(now)
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(today, -(n - 1 - i))
    return { start, end: addDays(start, 1) }
  })
}

// ───────── Pflege ─────────

export async function careData(s: Scope) {
  const { orgId, unitIds, days, now } = s
  for (const u of unitIds) await ensureTasksForDay(u, now)
  const today = startOfDay(now)
  const from = addDays(today, -(days - 1))
  const residents = await db.resident.findMany({
    where: { orgId, unitId: { in: unitIds }, status: { in: ['active', 'absent'] } },
    select: { id: true, firstName: true, lastName: true, unitId: true, room: { select: { number: true } }, nutrition: { select: { fluidTargetMl: true } } },
  })
  const rIds = residents.map((r) => r.id)
  const wk = weeks(12, now)
  const [openToday, overdue, falls, wounds, weights, intake] = await Promise.all([
    db.task.count({ where: { orgId, unitId: { in: unitIds }, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: today, lt: addDays(today, 1) } } }),
    db.task.groupBy({
      by: ['category'],
      where: { orgId, unitId: { in: unitIds }, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: from, lt: addMinutes(now, -15) }, source: { not: 'medication' } },
      _count: true,
    }),
    db.incident.findMany({ where: { orgId, unitId: { in: unitIds }, type: { key: 'fall' }, occurredAt: { gte: wk[0].start } }, select: { occurredAt: true, nearMiss: true } }),
    db.wound.findMany({ where: { residentId: { in: rIds }, status: { in: ['open', 'healing'] } }, select: { kind: true, status: true, origin: true, residentId: true } }),
    db.vitalSign.findMany({ where: { residentId: { in: rIds }, weight: { not: null }, at: { gte: addDays(now, -30) }, ...LIVE }, select: { residentId: true, at: true, weight: true }, orderBy: { at: 'asc' } }),
    db.intakeLog.groupBy({ by: ['residentId'], where: { residentId: { in: rIds }, kind: 'drink', at: { gte: today } }, _sum: { amountMl: true } }),
  ])

  const overdueRows = overdue.map((o) => ({ category: o.category, n: o._count })).sort((a, b) => b.n - a.n)

  // Evaluationen der Pflegeplanung (PRD §9.2, §64 «fehlende Evaluationen»): Bereiche aktiver Pläne mit überschrittenem Termin
  const areas = await db.carePlanArea.findMany({
    where: { carePlan: { status: 'active', residentId: { in: rIds } } },
    select: { domain: true, evaluateBy: true, carePlan: { select: { residentId: true } } },
  })
  const planned = new Set(areas.map((a) => a.carePlan.residentId))
  const evalOverdue = areas
    .filter((a) => a.evaluateBy && a.evaluateBy < today)
    .map((a) => ({ resident: residents.find((r) => r.id === a.carePlan.residentId)!, domain: a.domain, due: a.evaluateBy!, days: Math.floor((today.getTime() - startOfDay(a.evaluateBy!).getTime()) / 86_400_000) }))
    .sort((a, b) => a.due.getTime() - b.due.getTime())
  const evaluations = {
    areas: areas.length,
    overdue: evalOverdue,
    dueWeek: areas.filter((a) => a.evaluateBy && a.evaluateBy >= today && a.evaluateBy < addDays(today, 7)).length,
    noDate: areas.filter((a) => !a.evaluateBy).length,
    withoutPlan: residents.filter((r) => !planned.has(r.id)).length,
    domainNames: Object.fromEntries((await db.careDomain.findMany({ where: { orgId }, select: { key: true, name: true } })).map((d) => [d.key, d.name])) as Record<string, string>,
  }
  const fallWeeks = wk.map((w) => ({ ...w, n: falls.filter((f) => f.occurredAt >= w.start && f.occurredAt < w.end && !f.nearMiss).length }))

  const woundKinds = new Map<string, number>()
  for (const w of wounds) woundKinds.set(w.kind, (woundKinds.get(w.kind) ?? 0) + 1)
  const inHouse = wounds.filter((w) => /haus|house|interne|interno|struttura/i.test(w.origin ?? '')).length

  // Gewichtsverlust > 5 % in 30 Tagen (frühester gegen letzten Wert)
  const byRes = new Map<string, { first: number; firstAt: Date; last: number; lastAt: Date }>()
  for (const v of weights) {
    const e = byRes.get(v.residentId)
    if (!e) byRes.set(v.residentId, { first: v.weight!, firstAt: v.at, last: v.weight!, lastAt: v.at })
    else Object.assign(e, { last: v.weight!, lastAt: v.at })
  }
  const weightLoss = residents
    .map((r) => {
      const e = byRes.get(r.id)
      if (!e || e.lastAt.getTime() - e.firstAt.getTime() < 3 * 86_400_000) return null
      const pct = ((e.last - e.first) / e.first) * 100
      return { resident: r, from: e.first, to: e.last, pct, measured: byRes.has(r.id) }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  const weighed = byRes.size

  // Trinkmenge heute gegen Ziel, anteilig zur Tageszeit (07–21 Uhr)
  const h = now.getHours() + now.getMinutes() / 60
  const share = Math.max(0, Math.min(1, (h - 7) / 14))
  const fluids = residents
    .filter((r) => r.nutrition?.fluidTargetMl)
    .map((r) => {
      const ml = intake.find((x) => x.residentId === r.id)?._sum.amountMl ?? 0
      const target = r.nutrition!.fluidTargetMl!
      const expected = Math.round(target * share)
      return { resident: r, ml, target, expected, below: ml < expected * 0.8, documented: intake.some((x) => x.residentId === r.id) }
    })
  return {
    residents: residents.length,
    openToday,
    overdueTotal: overdueRows.reduce((s, r) => s + r.n, 0),
    overdueRows,
    fallWeeks,
    falls30: falls.filter((f) => f.occurredAt >= addDays(now, -30) && !f.nearMiss).length,
    wounds: { total: wounds.length, open: wounds.filter((w) => w.status === 'open').length, healing: wounds.filter((w) => w.status === 'healing').length, inHouse, kinds: [...woundKinds.entries()].sort((a, b) => b[1] - a[1]), residents: new Set(wounds.map((w) => w.residentId)).size },
    weightLoss: weightLoss.filter((w) => w.pct <= -5).sort((a, b) => a.pct - b.pct),
    weighed,
    fluids: fluids.sort((a, b) => a.ml / a.target - b.ml / b.target),
    evaluations,
    fluidShare: share,
  }
}

// ───────── Management ─────────

type Coverage = Record<string, number>
/** Sollbesetzung aus Organization.settings.coverage: { F: 4, S: 3, N: 1 } oder je Bereich { <unitId>: { F: 4 } }. */
export function coverageFor(settings: unknown, unitId: string): Coverage | null {
  const c = (settings as { coverage?: unknown } | null)?.coverage
  if (!c || typeof c !== 'object') return null
  const obj = c as Record<string, unknown>
  const unit = obj[unitId]
  if (unit && typeof unit === 'object') return unit as Coverage
  const flat = Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === 'number')) as Coverage
  return Object.keys(flat).length ? flat : null
}

export async function managementData(s: Scope & { settings: unknown }) {
  const { orgId, unitIds, days, now } = s
  const today = startOfDay(now)
  const from = addDays(today, -(days - 1))
  const useWeeks = days > 31
  const buckets = useWeeks ? weeks(Math.ceil(days / 7), now) : daysBack(days, now)

  const shiftTypesP = db.shiftType.findMany({ where: { orgId }, orderBy: { start: 'asc' } })
  const [taskDays, incidents, types, shiftTypes, shifts, residents, staffIds, seenBy] = await Promise.all([
    taskMinutesByDay(orgId, unitIds, buckets[0].start, addDays(today, 1), from),
    db.incident.findMany({ where: { orgId, unitId: { in: unitIds }, occurredAt: { gte: addDays(today, -7 * 13) } }, select: { occurredAt: true, typeId: true, nearMiss: true } }),
    db.incidentType.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
    shiftTypesP,
    db.shift.findMany({
      where: { unitId: { in: unitIds }, date: { gte: dbDate(today), lt: dbDate(addDays(today, 14)) }, status: { not: 'cancelled' } },
      select: { unitId: true, date: true, shiftTypeId: true, userId: true, status: true },
    }),
    db.resident.findMany({ where: { orgId, unitId: { in: unitIds }, status: 'active' }, select: { id: true } }),
    staffInScope(unitIds, now),
    // Personen mit Eintrag je Schicht und Tag – parallel zu den übrigen Abfragen
    shiftTypesP.then((st) => residentsWithNotePerShift(orgId, unitIds, st, addDays(from, -1), now)),
  ])

  // Pflegeaufwand: geplante vs. dokumentierte Minuten
  // (Aggregat je Kalendertag aus der Datenbank statt aller Aufgaben im Speicher – PRD §66)
  const care = buckets.map((b) => {
    const inB = taskDays.filter((k) => k.day >= b.start && k.day < b.end)
    return {
      ...b,
      planned: inB.reduce((x, k) => x + k.planned, 0),
      documented: inB.reduce((x, k) => x + k.documented, 0),
    }
  })

  // Ereignistrends je Typ (Kalenderwochen)
  const nW = Math.max(8, Math.min(13, Math.ceil(days / 7)))
  const wk = weeks(nW, now)
  const trend = types
    .map((tp) => ({ type: tp, weeks: wk.map((w) => ({ ...w, n: incidents.filter((i) => i.typeId === tp.id && i.occurredAt >= w.start && i.occurredAt < w.end).length })) }))
    .map((x) => ({ ...x, total: x.weeks.reduce((s, w) => s + w.n, 0) }))
  const incidentTotal = trend.reduce((s, x) => s + x.total, 0)

  // Dokumentationsqualität: Quittierungen mit Notiz
  const completed = taskDays.reduce((x, k) => x + k.completed, 0)
  const withNote = taskDays.reduce((x, k) => x + k.withNote, 0)

  // Dokumentationsqualität: Anteil Bewohnende mit Eintrag je Schicht (abgeschlossene Schichten im Zeitraum)
  const rIds = residents.map((r) => r.id)
  const perShift = shiftTypes.map((st) => {
    let sum = 0
    let n = 0
    for (let d = 0; d < days; d++) {
      const day = addDays(from, d)
      const b = shiftBounds(st, day)
      if (b.end > now) continue
      sum += rIds.length ? (seenBy.get(st.code + '|' + dateKey(day)) ?? 0) / rIds.length : 0
      n++
    }
    return { code: st.code, name: st.name, pct: n ? (sum / n) * 100 : null, shifts: n }
  })
  const shiftAvg = perShift.filter((p) => p.pct != null)
  const notesPerShiftPct = shiftAvg.length ? shiftAvg.reduce((s, p) => s + p.pct!, 0) / shiftAvg.length : null

  // Personalabdeckung: nächste 14 Tage, besetzte Dienste gegen Soll
  const coverageDays = Array.from({ length: 14 }, (_, i) => addDays(today, i))
  const anyTarget = unitIds.some((u) => coverageFor(s.settings, u))
  const coverage = shiftTypes.map((st) => ({
    code: st.code,
    name: st.name,
    days: coverageDays.map((day) => {
      const k = dateKey(day)
      const rows = shifts.filter((x) => x.shiftTypeId === st.id && dateKey(fromDbDate(x.date)) === k)
      const staffed = rows.filter((x) => x.userId && x.status !== 'open').length
      const open = rows.filter((x) => x.status === 'open').length
      const target = anyTarget ? unitIds.reduce((sum, u) => sum + (coverageFor(s.settings, u)?.[st.code] ?? 0), 0) : null
      return { day, staffed, open, target }
    }),
  }))
  const slots = coverage.flatMap((c) => c.days).filter((d) => d.target)
  const coveredPct = slots.length ? (slots.filter((d) => d.staffed >= d.target!).length / slots.length) * 100 : null

  const training = await trainingStatus(orgId, staffIds, now)
  const mandatoryPct = training.length ? (training.reduce((s, c) => s + c.valid, 0) / training.reduce((s, c) => s + c.staff, 0)) * 100 : null

  return {
    care, useWeeks, trend, incidentTotal, completed, withNote,
    perShift, notesPerShiftPct, residents: rIds.length,
    coverage, coveredPct, anyTarget, training, mandatoryPct, staff: staffIds.length,
  }
}

/**
 * Geplante und dokumentierte Minuten je Kalendertag (Stationszeit) sowie quittierte Aufgaben mit Notiz ab `from` –
 * als Aggregat in der Datenbank. Bei 400 Personen und 90 Tagen wären es sonst über 300 000 Zeilen im Speicher.
 */
async function taskMinutesByDay(orgId: string, unitIds: string[], start: Date, end: Date, from: Date) {
  if (!unitIds.length) return []
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const rows = await db.$queryRaw<{ day: Date; planned: bigint; documented: bigint; completed: bigint; withNote: bigint }[]>`
    SELECT (("dueAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date AS day,
      SUM("durationMin")::bigint AS planned,
      SUM(CASE WHEN status IN ('done', 'partial') THEN "durationMin" ELSE 0 END)::bigint AS documented,
      COUNT(*) FILTER (WHERE status IN ('done', 'partial') AND "dueAt" >= (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC')) AS completed,
      COUNT(*) FILTER (WHERE status IN ('done', 'partial') AND "dueAt" >= (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND btrim(COALESCE(note, '')) <> '') AS "withNote"
    FROM "Task"
    WHERE "orgId" = ${orgId} AND "unitId" = ANY(${unitIds}) AND "dueAt" >= (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND "dueAt" < (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY 1`
  // date → lokale Mitternacht, damit die Zuordnung zu Tages-/Wochenfenstern wie bisher über Date-Vergleiche läuft
  return rows.map((r) => ({ day: fromDbDate(r.day), planned: Number(r.planned), documented: Number(r.documented), completed: Number(r.completed), withNote: Number(r.withNote) }))
}

/**
 * Anzahl Personen mit mindestens einem Verlaufseintrag je Schicht (Code) und Schichtbeginn-Tag (Stationszeit).
 * Nachtdienste über Mitternacht zählen zum Vortag – wie `shiftBounds`. Schlüssel: `${code}|${YYYY-MM-DD}`.
 */
async function residentsWithNotePerShift(orgId: string, unitIds: string[], shiftTypes: { code: string; start: string; end: string }[], from: Date, to: Date) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const rows = await db.$queryRaw<{ code: string; day: Date; n: bigint }[]>`
    SELECT st.code, CASE WHEN st.e <= st.s AND x.m < st.e THEN x.d - 1 ELSE x.d END AS day, COUNT(DISTINCT x.rid) AS n
    FROM (
      SELECT o."residentId" AS rid, l::date AS d, EXTRACT(HOUR FROM l)::int * 60 + EXTRACT(MINUTE FROM l)::int AS m
      FROM (SELECT "residentId", (("at" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}) AS l FROM "Observation"
            WHERE "residentId" IN (SELECT id FROM "Resident" WHERE "orgId" = ${orgId} AND "unitId" = ANY(${unitIds}) AND status = 'active') AND "at" >= (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND "at" < (${to.toISOString()}::timestamptz AT TIME ZONE 'UTC')) o
    ) x
    JOIN unnest(${shiftTypes.map((t) => t.code)}::text[], ${shiftTypes.map((t) => mins(t.start))}::int[], ${shiftTypes.map((t) => mins(t.end))}::int[]) AS st(code, s, e)
      ON CASE WHEN st.e > st.s THEN x.m >= st.s AND x.m < st.e ELSE x.m >= st.s OR x.m < st.e END
    GROUP BY 1, 2`
  return new Map(rows.map((r) => [r.code + '|' + dateKey(fromDbDate(r.day)), Number(r.n)]))
}

/** Mitarbeitende eines Bereichs = Personen mit Diensten dort (letzte und nächste 30 Tage). */
export async function staffInScope(unitIds: string[], now: Date) {
  const rows = await db.shift.findMany({
    where: { unitId: { in: unitIds }, userId: { not: null }, date: { gte: dbDate(addDays(now, -30)), lte: dbDate(addDays(now, 30)) }, user: { active: true } },
    select: { userId: true },
    distinct: ['userId'],
  })
  return rows.map((r) => r.userId!)
}

/** Status der Pflichtschulungen je Kurs (aggregiert). */
export async function trainingStatus(orgId: string, staffIds: string[], now: Date) {
  const courses = await db.course.findMany({
    where: { orgId, mandatory: true, published: true },
    include: { enrollments: { where: { userId: { in: staffIds } } } },
    orderBy: { title: 'asc' },
  })
  return courses.map((c) => {
    let valid = 0, expired = 0, overdue = 0, progress = 0, assigned = 0
    for (const e of c.enrollments) {
      const exp = e.completedAt && c.validityMonths ? new Date(e.completedAt.getFullYear(), e.completedAt.getMonth() + c.validityMonths, e.completedAt.getDate()) : null
      if (e.status === 'completed' && (!exp || exp > now)) valid++
      else if (e.status === 'expired' || (e.status === 'completed' && exp && exp <= now)) expired++
      else if (e.dueAt && e.dueAt < now) overdue++
      else if (e.status === 'in_progress') progress++
      else assigned++
    }
    const missing = Math.max(0, staffIds.length - c.enrollments.length)
    return { id: c.id, title: c.title, staff: staffIds.length, valid, expired, overdue, progress, assigned, missing }
  })
}

// ───────── Workforce ─────────

export async function workforceData(s: Scope & { canTeam: boolean; canDocs: boolean }) {
  const { orgId, unitIds, now } = s
  const today = startOfDay(now)
  const staffIds = await staffInScope(unitIds, now)
  const end = addDays(today, 30)
  const [absences, openShifts, shiftTypes, units] = await Promise.all([
    db.absence.findMany({ where: { userId: { in: staffIds }, status: { in: ['approved', 'requested'] }, to: { gte: dbDate(today) }, from: { lt: dbDate(end) } }, select: { kind: true, from: true, to: true, status: true } }),
    db.shift.findMany({
      where: { unitId: { in: unitIds }, status: 'open', date: { gte: dbDate(today), lt: dbDate(end) } },
      include: { shiftType: true, unit: { select: { name: true } } },
      orderBy: { date: 'asc' },
    }),
    db.shiftType.findMany({ where: { orgId }, orderBy: { start: 'asc' } }),
    db.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, locationId: true } }),
  ])
  const absDays = Array.from({ length: 30 }, (_, i) => addDays(today, i)).map((day) => {
    const k = dbDate(day).getTime()
    const on = absences.filter((a) => a.from.getTime() <= k && a.to.getTime() >= k)
    return { day, approved: on.filter((a) => a.status === 'approved').length, requested: on.filter((a) => a.status === 'requested').length }
  })
  const byKind = new Map<string, { approved: number; requested: number; days: number }>()
  for (const a of absences) {
    const e = byKind.get(a.kind) ?? { approved: 0, requested: 0, days: 0 }
    e[a.status === 'approved' ? 'approved' : 'requested']++
    const f = Math.max(dbDate(today).getTime(), a.from.getTime())
    const t = Math.min(dbDate(addDays(end, -1)).getTime(), a.to.getTime())
    e.days += Math.max(0, Math.round((t - f) / 86_400_000) + 1)
    byKind.set(a.kind, e)
  }
  const training = await trainingStatus(orgId, staffIds, now)

  // Kenntnisnahmen: Mitteilungen mit Bestätigungspflicht und Dokumente
  const locationIds = [...new Set(units.map((u) => u.locationId))]
  const [posts, docs] = await Promise.all([
    s.canTeam
      ? db.post.findMany({
          where: {
            requireAck: true, publishedAt: { gte: addDays(now, -90) },
            channel: { orgId, archived: false, OR: [{ unitId: { in: unitIds } }, { unitId: null, locationId: { in: locationIds } }, { unitId: null, locationId: null }] },
          },
          select: { id: true, title: true, publishedAt: true, audienceRoles: true, channel: { select: { name: true } } },
          orderBy: { publishedAt: 'desc' },
          take: 20,
        })
      : [],
    s.canDocs ? db.document.findMany({ where: { orgId, requireAck: true, status: 'approved' }, select: { id: true, title: true, currentVersion: true, audienceRoles: true } }) : [],
  ])
  const acks = staffIds.length
    ? await db.acknowledgement.findMany({
        where: { userId: { in: staffIds }, OR: [{ subjectType: 'post', subjectId: { in: posts.map((p) => p.id) } }, { subjectType: 'document', subjectId: { in: docs.map((d) => d.id) } }] },
        select: { userId: true, subjectType: true, subjectId: true, version: true },
      })
    : []
  // Grundgesamtheit je Eintrag = Mitarbeitende des Bereichs in der Zielgruppe (Rollen; leer = alle)
  const roleKeys = await roleKeysByUserIds(staffIds)
  const audience = (roles: string[]) => new Set(staffIds.filter((u) => inAudience(roles, roleKeys.get(u) ?? [])))
  const item = (kind: 'post' | 'document', id: string, title: string, sub: string, roles: string[], match: (a: (typeof acks)[number]) => boolean) => {
    const who = audience(roles)
    return { kind, id, title, sub, total: who.size, n: acks.filter((a) => who.has(a.userId) && match(a)).length }
  }
  const ackItems = [
    ...posts.map((p) => item('post', p.id, p.title, p.channel.name, p.audienceRoles, (a) => a.subjectType === 'post' && a.subjectId === p.id)),
    ...docs.map((d) => item('document', d.id, d.title, d.currentVersion ? 'v' + d.currentVersion : '', d.audienceRoles, (a) => a.subjectType === 'document' && a.subjectId === d.id && a.version === (d.currentVersion ?? ''))),
  ]
  return {
    staff: staffIds.length,
    absDays,
    absenceKinds: [...byKind.entries()],
    absentToday: absDays[0]?.approved ?? 0,
    openShifts: openShifts.map((x) => ({ id: x.id, date: fromDbDate(x.date), code: x.shiftType.code, name: x.shiftType.name, start: x.shiftType.start, end: x.shiftType.end, unit: x.unit.name, qual: x.requiredQualification })),
    shiftTypes,
    training,
    ackItems,
  }
}
