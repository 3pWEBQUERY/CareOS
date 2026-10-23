import 'server-only'
import { db } from '@/lib/db'
import { addDays, dateKey, dbDate, parseDateKey } from '@/lib/time'
import { absencesIn, coverageDays, coverageTargets, dbKey, hasQualOn, keyQualification, qualifiedUserIds, unitStaff } from '@/app/(app)/schedule/lib'
import { cellKey, monthDays, readShiftPrefs, rosterRules, shiftDay, type Grid, type RProblem, type Wish } from './model'

/** Abwesenheiten, die als Arbeitszeit gutgeschrieben werden. */
const CREDITED = new Set(['vacation', 'sick', 'training'])

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const monthStart = (month: string) => parseDateKey(month + '-01')

/** Freigabestatus eines Monats: ohne Eintrag gilt er als freigegeben. */
export async function periodStatus(unitId: string, month: string) {
  const row = await db.schedulePeriod.findUnique({ where: { unitId_month: { unitId, month: dbDate(monthStart(month)) } } })
  return { row, status: row?.status ?? ('released' as const) }
}

/**
 * Monatsplanung eines Bereichs laden: Planungsaufgabe für Regelprüfung und Solver, aktueller Plan und alles, was das
 * Raster anzeigt (Dienst-IDs, Abwesenheiten, Dienste in anderen Bereichen, Wünsche).
 */
export async function loadRoster(orgId: string, settings: unknown, unitId: string, month: string, now = new Date()) {
  const days = monthDays(month)
  const first = days[0]
  const last = days[days.length - 1]
  const before = Array.from({ length: 7 }, (_, i) => shiftDay(first, i - 7))
  const after = Array.from({ length: 7 }, (_, i) => shiftDay(last, i + 1))
  const from = parseDateKey(before[0])
  const to = parseDateKey(after[after.length - 1])
  const today = dateKey(now)

  const [types, staffRaw, key, period, units] = await Promise.all([
    db.shiftType.findMany({ where: { orgId }, orderBy: { start: 'asc' }, include: { _count: { select: { shifts: true } } } }),
    unitStaff(orgId, unitId, parseDateKey(first), parseDateKey(last)),
    keyQualification(orgId),
    periodStatus(unitId, month),
    db.unit.findMany({ where: { orgId }, select: { id: true, name: true, shortName: true } }),
  ])
  const ids = staffRaw.map((s) => s.id)
  const [pct, shifts, absences, wishes, quals, openShifts] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, employmentPct: true, shiftPrefs: true } }),
    db.shift.findMany({ where: { userId: { in: ids }, date: { gte: dbDate(from), lte: dbDate(to) }, status: { not: 'cancelled' } }, include: { shiftType: true }, orderBy: { createdAt: 'asc' } }),
    absencesIn(ids, from, to),
    db.shiftWish.findMany({ where: { userId: { in: ids }, date: { gte: dbDate(parseDateKey(first)), lte: dbDate(parseDateKey(last)) } }, include: { shiftType: true } }),
    qualifiedUserIds(key?.id, ids),
    db.shift.findMany({ where: { unitId, userId: null, status: 'open', date: { gte: dbDate(parseDateKey(first)), lte: dbDate(parseDateKey(last)) } }, include: { shiftType: true } }),
  ])
  const pctOf = new Map(pct.map((x) => [x.id, x.employmentPct]))
  const codes = types.map((t) => t.code)
  const prefsOf = new Map(pct.map((x) => [x.id, readShiftPrefs(x.shiftPrefs, codes)]))
  const unitName = new Map(units.map((u) => [u.id, u.shortName || u.name]))
  const people = staffRaw.map((s) => ({ ...s, pct: pctOf.get(s.id) ?? 100, key: hasQualOn(quals, s.id, parseDateKey(first)), prefs: prefsOf.get(s.id) ?? {} }))

  const current: Grid = {}
  const locked: RProblem['locked'] = {}
  const foreign: RProblem['foreign'] = {}
  const shiftAt: Record<string, { id: string; typeId: string; status: string; note: string | null; req: string | null; unit: string | null }> = {}
  const monthSet = new Set(days)
  for (const s of shifts) {
    const d = dbKey(s.date)
    const k = cellKey(s.userId!, d)
    if (k in shiftAt) continue
    shiftAt[k] = { id: s.id, typeId: s.shiftTypeId, status: s.status, note: s.note, req: s.requiredQualification, unit: s.unitId === unitId ? null : unitName.get(s.unitId) ?? '' }
    if (s.unitId !== unitId) { locked[k] = s.shiftType.code; foreign[k] = true; continue }
    if (!monthSet.has(d) || d < today || s.status === 'swap_requested') locked[k] = s.shiftType.code
    else current[k] = s.shiftType.code
  }
  // Vergangene Tage und Kontexttage sind für die Planung gesperrt (auch leere Zellen)
  for (const person of people)
    for (const d of [...before, ...days, ...after]) {
      const k = cellKey(person.id, d)
      if (!(k in locked) && (!monthSet.has(d) || d < today)) locked[k] = current[k] ?? null
    }

  const absent: RProblem['absent'] = {}
  const credit: RProblem['credit'] = {}
  const absenceAt: Record<string, { kind: string; status: string }> = {}
  for (const a of absences)
    for (let d = dbKey(a.from); d <= dbKey(a.to); d = shiftDay(d, 1)) {
      if (d < before[0] || d > after[after.length - 1]) continue
      const k = cellKey(a.userId, d)
      if (absent[k] === 'approved') continue
      absent[k] = a.status === 'approved' ? 'approved' : 'requested'
      absenceAt[k] = { kind: a.kind, status: a.status }
      if (a.status === 'approved' && CREDITED.has(a.kind)) credit[k] = true
    }

  const wishMap: Record<string, Wish> = {}
  const wishNote: Record<string, string> = {}
  for (const w of wishes) {
    const k = cellKey(w.userId, dbKey(w.date))
    wishMap[k] = w.kind === 'shift' && w.shiftType ? { kind: 'shift', code: w.shiftType.code } : { kind: 'off' }
    if (w.note) wishNote[k] = w.note
  }

  const problem: RProblem = {
    days, before, after,
    types: types.map((t) => ({ code: t.code, start: t.start, end: t.end, breakMinutes: t.breakMinutes })),
    targets: coverageTargets(settings, codes),
    targetDays: coverageDays(settings, codes),
    people: people.map((x) => ({ id: x.id, name: x.name, pct: x.pct, level: x.level, key: x.key, ...x.prefs })),
    absent, credit, wishes: wishMap, locked, foreign,
    rules: rosterRules(settings),
  }
  return { problem, current, types, people, key, period, shiftAt, absenceAt, wishNote, openShifts, today, from, to: addDays(to, 0) }
}

export type RosterData = Awaited<ReturnType<typeof loadRoster>>
