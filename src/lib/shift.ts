import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, currentShiftBounds, dbDate, fromDbDate, shiftAt, shiftBounds, startOfDay, type ShiftDef } from '@/lib/time'

export async function shiftTypes(orgId: string): Promise<ShiftDef[]> {
  return db.shiftType.findMany({ where: { orgId }, orderBy: { start: 'asc' }, select: { code: true, name: true, start: true, end: true } })
}

/** Eigener Dienst des Benutzers, der gerade läuft (oder heute noch beginnt). */
export async function myShiftNow(userId: string, orgId: string, now = new Date()) {
  const rows = await db.shift.findMany({
    where: { userId, date: { in: [dbDate(addDays(now, -1)), dbDate(now)] }, status: { not: 'cancelled' } },
    include: { shiftType: true, unit: true },
    orderBy: { date: 'asc' },
  })
  for (const r of rows) {
    const b = shiftBounds(r.shiftType, fromDbDate(r.date))
    if (now >= b.start && now < b.end) return { ...r, bounds: b, running: true }
  }
  const later = rows.map((r) => ({ ...r, bounds: shiftBounds(r.shiftType, fromDbDate(r.date)), running: false })).find((r) => r.bounds.start > now && r.bounds.start < addDays(startOfDay(now), 1))
  void orgId
  return later ?? null
}

export async function currentShiftLabel(ctx: Ctx) {
  const mine = await myShiftNow(ctx.user.id, ctx.org.id)
  if (mine) return { name: mine.shiftType.name, start: mine.shiftType.start, end: mine.shiftType.end, mine: true, code: mine.shiftType.code }
  const s = shiftAt(await shiftTypes(ctx.org.id))
  return s ? { ...s, mine: false } : null
}

/** Grenzen der laufenden Stationsschicht (für Übergabe und Aufgabenfilter). */
export async function runningShift(orgId: string, now = new Date()) {
  const types = await shiftTypes(orgId)
  const s = shiftAt(types, now)
  if (!s) return null
  const b = currentShiftBounds(s, now)
  return { ...s, from: b.start, to: b.end }
}

/**
 * Ende des letzten Dienstes des Benutzers (PRD §11.3 "Seit meinem letzten Dienst").
 * Fallback: letzte Aktivität einer früheren Sitzung, sonst 24 Stunden.
 */
export async function lastShiftEnd(userId: string, currentSessionId: string, now = new Date()) {
  const past = await db.shift.findMany({
    where: { userId, date: { lt: dbDate(now), gte: dbDate(addDays(now, -21)) }, status: { not: 'cancelled' } },
    include: { shiftType: true },
    orderBy: { date: 'desc' },
    take: 3,
  })
  for (const p of past) {
    const b = shiftBounds(p.shiftType, fromDbDate(p.date))
    if (b.end <= now) return { at: b.end, source: 'shift' as const }
  }
  const prev = await db.session.findFirst({ where: { userId, id: { not: currentSessionId } }, orderBy: { lastSeenAt: 'desc' } })
  if (prev) return { at: prev.lastSeenAt, source: 'session' as const }
  return { at: new Date(now.getTime() - 24 * 3600_000), source: 'default' as const }
}
