import 'server-only'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import type { Ctx } from '@/lib/context'
import { addDays, dateKey, dbDate, fromDbDate, startOfDay } from '@/lib/time'

/** Soll-Besetzung je Dienstart (Organization.settings.coverage), Standard F:3, S:3, N:1. */
export const DEFAULT_COVERAGE: Record<string, number> = { F: 3, S: 3, N: 1 }

export function coverageTargets(settings: unknown, codes: string[]) {
  const raw = ((settings ?? {}) as { coverage?: Record<string, unknown> }).coverage ?? {}
  const out: Record<string, number> = {}
  for (const c of codes) {
    const v = Number(raw[c])
    out[c] = Number.isFinite(v) && v >= 0 ? Math.round(v) : DEFAULT_COVERAGE[c] ?? 1
  }
  return out
}

/** Wochentage je Dienstart, an denen die Soll-Besetzung gilt (Organization.settings.coverageDays), sonst täglich. */
export function coverageDays(settings: unknown, codes: string[]) {
  const raw = ((settings ?? {}) as { coverageDays?: Record<string, unknown> }).coverageDays ?? {}
  const out: Record<string, number[]> = {}
  for (const c of codes) {
    const v = raw[c]
    if (Array.isArray(v)) {
      const days = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
      if (days.length && days.length < 7) out[c] = days
    }
  }
  return out
}

/** Soll-Besetzung je Wochentag (Organization.settings.coverageByDay, Index 0 = So … 6 = Sa), falls gesetzt. */
export function coverageByDay(settings: unknown, codes: string[]) {
  const raw = ((settings ?? {}) as { coverageByDay?: Record<string, unknown> }).coverageByDay ?? {}
  const out: Record<string, number[]> = {}
  for (const c of codes) {
    const v = raw[c]
    if (Array.isArray(v) && v.length === 7 && v.every((n) => Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) <= 50)) out[c] = v.map(Number)
  }
  return out
}

export function weekStart(d: Date) {
  const x = startOfDay(d)
  return addDays(x, -((x.getDay() + 6) % 7))
}

export function isoWeek(d: Date) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - day)
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  return Math.ceil(((x.getTime() - y0.getTime()) / 86400000 + 1) / 7)
}

/** Höchste Qualifikationsstufe der Organisation (z. B. Pflegefachperson HF) – mindestens eine pro Dienst. */
export async function keyQualification(orgId: string) {
  return db.qualification.findFirst({ where: { orgId }, orderBy: { level: 'desc' } })
}

/** Personen, die die Qualifikation am Tag besitzen (validUntil beachtet). */
export async function qualifiedUserIds(qualificationId: string | null | undefined, userIds: string[]) {
  if (!qualificationId || !userIds.length) return new Map<string, Date | null>()
  const rows = await db.userQualification.findMany({ where: { qualificationId, userId: { in: userIds } } })
  return new Map(rows.map((r) => [r.userId, r.validUntil]))
}

export const hasQualOn = (q: Map<string, Date | null>, userId: string, day: Date) => q.has(userId) && (!q.get(userId) || q.get(userId)! >= startOfDay(day))

/**
 * Team eines Bereichs: Teammitglieder (Team.unitId), Rollen mit Bereich und alle, die im Zeitraum dort Dienste haben.
 */
export async function unitStaff(orgId: string, unitId: string, from: Date, to: Date) {
  const [teams, roles, shifts] = await Promise.all([
    db.teamMember.findMany({ where: { team: { orgId, unitId } }, select: { userId: true } }),
    db.roleAssignment.findMany({ where: { unitId, user: { orgId } }, select: { userId: true } }),
    db.shift.findMany({ where: { unitId, date: { gte: dbDate(from), lte: dbDate(to) }, userId: { not: null } }, select: { userId: true }, distinct: ['userId'] }),
  ])
  const ids = [...new Set([...teams, ...roles, ...shifts].map((r) => r.userId!).filter(Boolean))]
  const users = await db.user.findMany({
    where: { id: { in: ids }, orgId, active: true },
    select: { id: true, firstName: true, lastName: true, initials: true, jobTitle: true, qualifications: { select: { qualification: { select: { name: true, level: true } } } } },
  })
  return users
    .map((u) => {
      const q = u.qualifications.map((x) => x.qualification).sort((a, b) => b.level - a.level)[0]
      return { id: u.id, name: `${u.lastName} ${u.firstName}`, short: `${u.firstName} ${u.lastName}`, initials: u.initials, job: u.jobTitle ?? '', qual: q?.name ?? '', level: q?.level ?? 0 }
    })
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
}

/** Genehmigte und beantragte Abwesenheiten, die einen Zeitraum überlappen. */
export async function absencesIn(userIds: string[], from: Date, to: Date) {
  return db.absence.findMany({ where: { userId: { in: userIds }, status: { not: 'rejected' }, from: { lte: dbDate(to) }, to: { gte: dbDate(from) } } })
}

export type PlanShift = { id: string; typeId: string; code: string; userId: string | null; status: string; note: string | null; req: string | null; dateKey: string }

/**
 * Wochenplan eines Bereichs mit Besetzung (Ist/Soll) und Qualifikationsabdeckung je Tag und Dienstart.
 * Abwesende (genehmigt) zählen nicht zur Besetzung; Konflikte werden gemeldet.
 */
export async function planWeek(orgId: string, settings: unknown, unitId: string, from: Date, days: number) {
  const to = addDays(from, days - 1)
  const [types, shifts, key, staff] = await Promise.all([
    db.shiftType.findMany({ where: { orgId }, orderBy: { start: 'asc' } }),
    db.shift.findMany({ where: { unitId, date: { gte: dbDate(from), lte: dbDate(to) }, status: { not: 'cancelled' } }, include: { shiftType: true } }),
    keyQualification(orgId),
    unitStaff(orgId, unitId, from, to),
  ])
  const targets = coverageTargets(settings, types.map((t) => t.code))
  const cdays = coverageDays(settings, types.map((t) => t.code))
  const byDay = coverageByDay(settings, types.map((t) => t.code))
  const targetOn = (code: string, day: Date) => (byDay[code] ? byDay[code][day.getDay()] : cdays[code] && !cdays[code].includes(day.getDay()) ? 0 : targets[code] ?? 0)
  const userIds = [...new Set([...staff.map((s) => s.id), ...shifts.map((s) => s.userId).filter((x): x is string => !!x)])]
  const [absences, quals] = await Promise.all([absencesIn(userIds, from, to), qualifiedUserIds(key?.id, userIds)])
  const dayKeys = Array.from({ length: days }, (_, i) => addDays(from, i))
  const absentOn = (userId: string, day: Date, status?: 'approved') =>
    absences.find((a) => a.userId === userId && (!status || a.status === status) && a.from <= dbDate(day) && a.to >= dbDate(day))

  const plan: PlanShift[] = shifts.map((s) => ({ id: s.id, typeId: s.shiftTypeId, code: s.shiftType.code, userId: s.userId, status: s.status, note: s.note, req: s.requiredQualification, dateKey: dbKey(s.date) }))
  const coverage = dayKeys.map((day) => {
    const k = dateKey(day)
    return {
      day,
      key: k,
      types: types.map((t) => {
        const assigned = shifts.filter((s) => s.shiftTypeId === t.id && dbKey(s.date) === k && s.userId)
        const present = assigned.filter((s) => !absentOn(s.userId!, day, 'approved'))
        const conflicts = assigned.filter((s) => absentOn(s.userId!, day)).map((s) => ({ userId: s.userId!, shiftId: s.id }))
        const open = shifts.filter((s) => s.shiftTypeId === t.id && dbKey(s.date) === k && !s.userId).length
        return { typeId: t.id, code: t.code, name: t.name, n: present.length, target: targetOn(t.code, day), hf: present.some((s) => hasQualOn(quals, s.userId!, day)), open, conflicts }
      }),
    }
  })
  return { types, targets, staff, plan, absences, coverage, key, quals, to }
}

/** @db.Date → "YYYY-MM-DD" */
export const dbKey = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Monate im Entwurf (SchedulePeriod.status = draft) sind nur für die Planenden sichtbar. Liefert eine Bedingung,
 * die Dienste solcher Monate für die aktuelle Person ausblendet, und die betroffenen Monate für den Hinweis.
 */
export async function draftFilter(ctx: Ctx, from: Date, to: Date) {
  const rows = await db.schedulePeriod.findMany({
    where: { orgId: ctx.org.id, status: 'draft', month: { gte: dbDate(new Date(from.getFullYear(), from.getMonth(), 1)), lte: dbDate(to) } },
    include: { unit: { select: { id: true, locationId: true } } },
  })
  const hidden = rows.filter((r) => !ctx.can('schedule.manage', { unitId: r.unit.id, locationId: r.unit.locationId }))
  const where: Prisma.ShiftWhereInput | undefined = hidden.length
    ? { NOT: { OR: hidden.map((r) => {
        const m = fromDbDate(r.month)
        return { unitId: r.unitId, date: { gte: dbDate(m), lte: dbDate(new Date(m.getFullYear(), m.getMonth() + 1, 0)) } }
      }) } }
    : undefined
  return { where, months: [...new Set(hidden.map((r) => dbKey(r.month).slice(0, 7)))] }
}
