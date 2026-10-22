import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { myShiftNow, runningShift, shiftTypes } from '@/lib/shift'
import { addDays, dateKey, dbDate, fromDbDate, shiftBounds, startOfDay, type ShiftDef } from '@/lib/time'
import { suggestAssignments, type Pair } from '@/lib/assignment-plan'

/**
 * Bewohnerzuordnung pro Dienst (PRD §7 «Bewohnerzuordnung», §70 «Für wen ist sie verantwortlich?», §71 «Meine Übergabe»).
 *
 * Eine Schicht ist – wie bei der Übergabe – Code + Startdatum (`ShiftAssignment.date`, Nachtdienst nach Mitternacht = Vortag).
 * Pro Person und Schicht können mehrere Mitarbeitende eingetragen sein (z. B. Fachperson und Pflegehelfer/in).
 *
 * Schnittstelle für andere Module (z. B. Aufgaben-Filter «Meine», Paket A):
 *
 *   const mine = await myResidentIds(ctx)            // string[] | null
 *   if (mine) where.OR = [{ assigneeId: ctx.user.id }, { residentId: { in: mine } }]
 *
 * `null` bedeutet: In der massgeblichen Schicht ist der angemeldeten Person (noch) niemand zugeteilt –
 * dann alle Bewohnenden des Bereichs zeigen und auf die Zuteilung hinweisen, nicht leer filtern.
 * Massgebliche Schicht: der eigene Dienst im Bereich (laufend oder heute später, `myShiftNow`), sonst die laufende Stationsschicht.
 */
export async function myResidentIds(ctx: Ctx, opts: { unitId?: string; now?: Date } = {}): Promise<string[] | null> {
  const unitId = opts.unitId ?? ctx.unit?.id
  if (!unitId) return null
  const ref = await assignmentShift(ctx, unitId, opts.now)
  if (!ref) return null
  const rows = await db.shiftAssignment.findMany({
    where: { orgId: ctx.org.id, unitId, shiftCode: ref.def.code, date: dbDate(ref.day), userId: ctx.user.id, resident: { status: { in: ['active', 'absent'] } } },
    select: { residentId: true },
  })
  return rows.length ? rows.map((r) => r.residentId) : null
}

export type AssignmentShift = { def: ShiftDef; day: Date; key: string; start: Date; end: Date; mine: boolean }

/** Schicht, auf die sich «meine» Zuteilung im Bereich bezieht (siehe oben). */
export async function assignmentShift(ctx: Ctx, unitId: string, now = new Date()): Promise<AssignmentShift | null> {
  const mine = await myShiftNow(ctx.user.id, ctx.org.id, now)
  if (mine && mine.unitId === unitId) {
    const day = fromDbDate(mine.date)
    return { def: mine.shiftType, day, key: dateKey(day), start: mine.bounds.start, end: mine.bounds.end, mine: true }
  }
  const s = await runningShift(ctx.org.id, now)
  if (!s) return null
  const day = startOfDay(s.from)
  return { def: { code: s.code, name: s.name, start: s.start, end: s.end }, day, key: dateKey(day), start: s.from, end: s.to, mine: false }
}

/** Schicht aus Code + Datumsschlüssel (Formulare, Übergabe). */
export async function shiftFromKey(orgId: string, code: string, key: string): Promise<AssignmentShift | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const def = (await shiftTypes(orgId)).find((s) => s.code === code)
  if (!def) return null
  const [y, m, d] = key.split('-').map(Number)
  const day = new Date(y, m - 1, d)
  const b = shiftBounds(def, day)
  return { def, day, key, start: b.start, end: b.end, mine: false }
}

export type AssignmentBoard = {
  shift: { code: string; date: string; name: string; start: string; end: string }
  residents: { id: string; name: string; room: string | null }[]
  staff: { id: string; initials: string; name: string; onDuty: boolean }[]
  pairs: Pair[]
  suggestion: Pair[]
  /** Woher der Vorschlag stammt (je Bewohner/in): letzte Schicht, Bezugsperson, Verteilung */
  suggestionSource: Record<string, 'history' | 'primary' | 'balance'>
}

/**
 * Daten für den Zuteilungsdialog: Bewohnende (Zimmerreihenfolge), Personen im Dienst laut Dienstplan,
 * bestehende Zuteilung und Vorschlag (letzte Schichten, Bezugsperson, gleichmässige Verteilung).
 */
export async function assignmentBoard(ctx: Ctx, unitId: string, ref: AssignmentShift, shiftLabel: string): Promise<AssignmentBoard> {
  const date = dbDate(ref.day)
  const [residents, shifts, pairs, history, types] = await Promise.all([
    db.resident.findMany({
      where: { orgId: ctx.org.id, unitId, status: { in: ['active', 'absent'] } },
      select: { id: true, firstName: true, lastName: true, primaryNurseId: true, room: { select: { number: true } } },
      orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }],
    }),
    db.shift.findMany({
      where: { unitId, date, status: { not: 'cancelled' }, userId: { not: null }, shiftType: { orgId: ctx.org.id, code: ref.def.code } },
      select: { userId: true },
    }),
    db.shiftAssignment.findMany({ where: { orgId: ctx.org.id, unitId, shiftCode: ref.def.code, date }, select: { residentId: true, userId: true } }),
    db.shiftAssignment.findMany({
      where: { orgId: ctx.org.id, unitId, date: { gte: dbDate(addDays(ref.day, -2)), lte: date }, NOT: { shiftCode: ref.def.code, date } },
      select: { residentId: true, userId: true, shiftCode: true, date: true },
    }),
    shiftTypes(ctx.org.id),
  ])
  const onDuty = [...new Set(shifts.map((s) => s.userId!))]
  const userIds = [...new Set([...onDuty, ...pairs.map((p) => p.userId)])]
  const users = await db.user.findMany({ where: { id: { in: userIds }, orgId: ctx.org.id }, select: { id: true, initials: true, firstName: true, lastName: true } })
  const startOf = (code: string, d: Date) => {
    const def = types.find((s) => s.code === code)
    return def ? shiftBounds(def, fromDbDate(d)).start.getTime() : fromDbDate(d).getTime()
  }
  const sug = suggestAssignments({
    residents: residents.map((r) => ({ id: r.id, primaryNurseId: r.primaryNurseId })),
    staff: onDuty,
    // Nur frühere Schichten zählen als «zuletzt betreut»
    history: history.map((h) => ({ residentId: h.residentId, userId: h.userId, at: startOf(h.shiftCode, h.date) })).filter((h) => h.at < ref.start.getTime()),
  })
  return {
    shift: { code: ref.def.code, date: ref.key, name: shiftLabel, start: ref.def.start, end: ref.def.end },
    residents: residents.map((r) => ({ id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null })),
    staff: users
      .map((u) => ({ id: u.id, initials: u.initials, name: `${u.firstName.charAt(0)}. ${u.lastName}`, onDuty: onDuty.includes(u.id) }))
      .sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || a.name.localeCompare(b.name)),
    pairs,
    suggestion: sug.pairs,
    suggestionSource: sug.source,
  }
}

/** Zuteilung einer Schicht je Bewohner/in: residentId → Kürzel (für Übergabekarten und Leitungsübersicht). */
export async function assignedInitials(orgId: string, unitId: string, code: string, day: Date) {
  const rows = await db.shiftAssignment.findMany({
    where: { orgId, unitId, shiftCode: code, date: dbDate(day) },
    select: { residentId: true, userId: true, user: { select: { initials: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const map = new Map<string, { userId: string; initials: string }[]>()
  for (const r of rows) map.set(r.residentId, [...(map.get(r.residentId) ?? []), { userId: r.userId, initials: r.user.initials }])
  return map
}
