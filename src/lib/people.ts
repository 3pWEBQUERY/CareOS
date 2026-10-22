import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { storageConfigured } from '@/lib/env'
import { fileUrl } from '@/lib/files'
import { addDays, dbDate, fromDbDate, shiftBounds } from '@/lib/time'
import { profileAccess, type PersonScope } from '@/lib/people-policy'

/**
 * Personenverzeichnis und Mitarbeiterprofil (PRD §55, §61). Liefert nur, was die betrachtende Person sehen darf
 * (Regeln in src/lib/people-policy.ts). Klinische Daten kommen hier nie vor.
 */

export type TodayState =
  | { kind: 'shift'; code: string; name: string; start: string; end: string; unit: string; running: boolean; done: boolean }
  | { kind: 'absent'; reason: string | null }
  | null

export const avatarUrl = (fileId: string | null | undefined) => (fileId && storageConfigured() ? fileUrl(fileId) : null)

/** Dienste heute (inkl. Nachtdienst vom Vortag, der noch läuft) und genehmigte Abwesenheiten heute. */
async function todayFor(orgId: string, userIds: string[] | null, now: Date) {
  const where = { unit: { orgId }, date: { in: [dbDate(addDays(now, -1)), dbDate(now)] }, status: { not: 'cancelled' as const }, userId: userIds ? { in: userIds } : { not: null } }
  const [shifts, absences] = await Promise.all([
    db.shift.findMany({ where, select: { userId: true, date: true, unit: { select: { name: true, shortName: true } }, shiftType: { select: { code: true, name: true, start: true, end: true } } } }),
    db.absence.findMany({ where: { status: 'approved', from: { lte: dbDate(now) }, to: { gte: dbDate(now) }, user: { orgId }, ...(userIds ? { userId: { in: userIds } } : {}) }, select: { userId: true, kind: true } }),
  ])
  const today = dbDate(now).getTime()
  const map = new Map<string, TodayState>()
  for (const s of shifts) {
    const b = shiftBounds(s.shiftType, fromDbDate(s.date))
    const running = now >= b.start && now < b.end
    const isToday = s.date.getTime() === today
    if (!running && !isToday) continue // Vortag, bereits beendet
    const cur = map.get(s.userId!)
    if (cur?.kind === 'shift' && cur.running) continue
    map.set(s.userId!, { kind: 'shift', code: s.shiftType.code, name: s.shiftType.name, start: s.shiftType.start, end: s.shiftType.end, unit: s.unit.shortName ?? s.unit.name, running, done: now >= b.end })
  }
  for (const a of absences) if (!map.has(a.userId)) map.set(a.userId, { kind: 'absent', reason: a.kind })
  return map
}

export type DirectoryRow = {
  id: string
  name: string
  firstName: string
  lastName: string
  initials: string
  jobTitle: string | null
  avatar: string | null
  unitIds: string[]
  units: string
  qualifications: string[]
  workPhone: string | null
  email: string
  today: TodayState
}

/** Alle aktiven Mitarbeitenden der Organisation, sortiert nach Nachname. */
export async function directory(ctx: Ctx, now = new Date()): Promise<DirectoryRow[]> {
  const [users, units] = await Promise.all([
    db.user.findMany({
      where: { orgId: ctx.org.id, active: true },
      select: {
        id: true, firstName: true, lastName: true, initials: true, jobTitle: true, avatarFileId: true, email: true, workPhone: true, primaryUnitId: true,
        roles: { select: { unitId: true, locationId: true } },
        qualifications: { select: { qualification: { select: { name: true, level: true } } } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    db.unit.findMany({ where: { orgId: ctx.org.id }, select: { id: true, name: true, shortName: true, locationId: true } }),
  ])
  const today = ctx.can('schedule.read') ? await todayFor(ctx.org.id, null, now) : new Map<string, TodayState>()
  const unitName = new Map(units.map((u) => [u.id, u.shortName ?? u.name]))
  return users.map((u) => {
    const unitIds = [...new Set([u.primaryUnitId, ...u.roles.flatMap((r) => (r.unitId ? [r.unitId] : r.locationId ? units.filter((x) => x.locationId === r.locationId).map((x) => x.id) : []))].filter((x): x is string => !!x))]
    const t = today.get(u.id) ?? null
    return {
      id: u.id, name: `${u.firstName} ${u.lastName}`, firstName: u.firstName, lastName: u.lastName, initials: u.initials, jobTitle: u.jobTitle,
      avatar: avatarUrl(u.avatarFileId), unitIds, units: u.primaryUnitId ? unitName.get(u.primaryUnitId) ?? '' : '',
      qualifications: u.qualifications.sort((a, b) => b.qualification.level - a.qualification.level).map((q) => q.qualification.name),
      workPhone: u.workPhone, email: u.email,
      // Abwesenheitsgrund nie in der Liste
      today: t?.kind === 'absent' ? { kind: 'absent', reason: null } : t,
    }
  })
}

/** Profil einer Person mit den Angaben, die die betrachtende Person sehen darf. null = nicht gefunden. */
export async function loadPerson(ctx: Ctx, id: string, now = new Date()) {
  const u = await db.user.findFirst({
    where: { id, orgId: ctx.org.id },
    select: {
      id: true, firstName: true, lastName: true, initials: true, jobTitle: true, email: true, phone: true, workPhone: true, phoneShared: true,
      avatarFileId: true, active: true, primaryUnitId: true, locale: true,
      roles: { select: { unitId: true, locationId: true, role: { select: { name: true } }, unit: { select: { name: true } }, location: { select: { name: true } } } },
      qualifications: { select: { validUntil: true, qualification: { select: { id: true, name: true, level: true } } } },
      teams: { select: { team: { select: { name: true } } } },
    },
  })
  if (!u) return null
  const units = await db.unit.findMany({ where: { orgId: ctx.org.id }, select: { id: true, name: true, locationId: true, location: { select: { name: true } } } })
  const unitLoc = (unitId: string) => units.find((x) => x.id === unitId)?.locationId
  const scope: PersonScope = {
    unitIds: [...new Set([u.primaryUnitId, ...u.roles.map((r) => r.unitId)].filter((x): x is string => !!x))],
    locationIds: [...new Set(u.roles.map((r) => r.locationId).filter((x): x is string => !!x))],
    orgWide: u.roles.some((r) => !r.unitId && !r.locationId),
  }
  const access = profileAccess({ viewerId: ctx.user.id, personId: u.id, grants: ctx.grants, person: scope, phoneShared: u.phoneShared, unitLocation: unitLoc })
  // Inaktive Konten sehen nur Zuständige (z. B. für Rückfragen nach Austritt)
  if (!u.active && !access.manager) return null

  const [todayMap, upcoming, certs, enrollments] = await Promise.all([
    access.shifts ? todayFor(ctx.org.id, [u.id], now) : Promise.resolve(new Map<string, TodayState>()),
    access.shifts
      ? db.shift.findMany({
          where: { userId: u.id, date: { gt: dbDate(now), lte: dbDate(addDays(now, 7)) }, status: { not: 'cancelled' } },
          select: { id: true, date: true, unit: { select: { name: true, shortName: true } }, shiftType: { select: { code: true, name: true, start: true, end: true } } },
          orderBy: { date: 'asc' },
        })
      : Promise.resolve([]),
    access.training ? db.certificate.findMany({ where: { userId: u.id }, orderBy: { issuedAt: 'desc' }, take: 12, select: { id: true, title: true, issuedAt: true, expiresAt: true, courseId: true } }) : Promise.resolve([]),
    access.training
      ? db.enrollment.findMany({ where: { userId: u.id, status: { in: ['assigned', 'in_progress', 'expired'] }, course: { orgId: ctx.org.id } }, select: { id: true, status: true, dueAt: true, course: { select: { id: true, title: true, mandatory: true } } }, orderBy: { dueAt: 'asc' } })
      : Promise.resolve([]),
  ])
  let today = todayMap.get(u.id) ?? null
  if (today?.kind === 'absent' && !access.absenceReason) today = { kind: 'absent', reason: null }
  const primary = units.find((x) => x.id === u.primaryUnitId)
  return {
    person: {
      id: u.id, firstName: u.firstName, lastName: u.lastName, initials: u.initials, jobTitle: u.jobTitle, email: u.email, active: u.active,
      workPhone: u.workPhone, phone: access.privatePhone ? u.phone : null, phoneShared: u.phoneShared,
      avatar: avatarUrl(u.avatarFileId), primaryUnit: primary ? `${primary.name} · ${primary.location.name}` : null,
      roles: u.roles.map((r) => ({ name: r.role.name, scope: r.unit?.name ?? r.location?.name ?? null })),
      teams: u.teams.map((t) => t.team.name),
      qualifications: u.qualifications
        .sort((a, b) => b.qualification.level - a.qualification.level || a.qualification.name.localeCompare(b.qualification.name))
        .map((q) => ({ id: q.qualification.id, name: q.qualification.name, level: q.qualification.level, validUntil: access.qualificationValidity ? q.validUntil : null })),
    },
    access,
    today,
    upcoming: upcoming.map((s) => ({ id: s.id, date: fromDbDate(s.date), code: s.shiftType.code, name: s.shiftType.name, start: s.shiftType.start, end: s.shiftType.end, unit: s.unit.shortName ?? s.unit.name })),
    certs,
    enrollments,
  }
}
