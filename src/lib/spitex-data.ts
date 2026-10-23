import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import type { Permission } from '@/lib/permissions'
import { decrypt } from '@/lib/crypto'
import { log } from '@/lib/log'
import { addDays, dateKey, dbDate, fromDbDate, sameDay, startOfDay } from '@/lib/time'
import {
  PLAN_AHEAD_DAYS, absenceBusy, appendSequences, isHomecare, shiftBusy, tourOrder, visitConflicts, visitsForDay, type Busy, type Conflict,
} from '@/lib/spitex'

/** Einsatzgebiete (Unit.kind = homecare), in denen die Person das Recht hat. */
export const spitexUnits = (ctx: Ctx, perm: Permission = 'spitex.read') =>
  ctx.units.filter((u) => isHomecare(u) && ctx.can(perm, { unitId: u.id, locationId: u.locationId }))

/** Gewähltes Einsatzgebiet: ?u=, sonst der Bereich der Topbar, sonst das erste erlaubte. */
export function pickUnit(ctx: Ctx, wanted?: string | null, perm: Permission = 'spitex.read') {
  const units = spitexUnits(ctx, perm)
  return { units, unit: units.find((u) => u.id === wanted) ?? units.find((u) => u.id === ctx.unit?.id) ?? units[0] ?? null }
}

/** Darf die Person den Zugang (Türcode, Schlüsselbox) im Bereich sehen? Nur wer vor Ort geht oder disponiert. */
export const canSeeAccess = (ctx: Ctx, unit: { id: string; locationId: string }) =>
  ctx.can('spitex.document', { unitId: unit.id, locationId: unit.locationId }) || ctx.can('spitex.plan', { unitId: unit.id, locationId: unit.locationId })

/** Zugang entschlüsseln; Klartext (Import, Demodaten) bleibt lesbar und wird beim ersten Abruf verschlüsselt. */
export function openAccessNote(v: string | null | undefined) {
  if (!v) return null
  try {
    return v.startsWith('v1.') ? decrypt(v) : v
  } catch {
    return null
  }
}

// ───────── Erzeugung je Tag (wie ensureTasksForDay) ─────────

const GEN_TTL_MS = 10 * 60_000
const LOCAL_TTL_MS = 30_000
const localChecked = new Map<string, number>()
const localInvalid = new Map<string, number>()
const lockKey = (unitId: string) => 'careos:homecare:' + unitId

/** Nach Änderungen an Wochenvorlagen oder Personen aufrufen, damit die Einsätze neu erzeugt werden (alle Instanzen). */
export function invalidateVisitGeneration(unitId: string) {
  for (const k of localChecked.keys()) if (k.startsWith(unitId + ':')) localChecked.delete(k)
  localInvalid.set(unitId, Date.now())
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(unitId)}))`
    await tx.homeCareGeneration.deleteMany({ where: { unitId } })
  }, { timeout: 60_000, maxWait: 30_000 }).catch((e) => { log.warn('homecare.invalidate_failed', { error: e instanceof Error ? e.message : String(e) }) })
}

/**
 * Erzeugt die Einsätze eines Tages aus den Wochenvorlagen der aktiven Klient/innen im Einsatzgebiet. Idempotent über
 * @@unique([templateId, date]); eine Erzeugung je Gebiet gleichzeitig (Advisory Lock), Merker HomeCareGeneration.
 * Nur heute und bis PLAN_AHEAD_DAYS voraus – vergangene Tage bleiben, wie sie disponiert wurden.
 */
export async function ensureVisitsForDay(unitId: string, day = new Date()) {
  const today = startOfDay()
  const d = startOfDay(day)
  if (d < today || d > addDays(today, PLAN_AHEAD_DAYS)) return
  const key = unitId + ':' + dateKey(d)
  const invalidAt = localInvalid.get(unitId) ?? 0
  const checked = localChecked.get(key) ?? 0
  if (checked > invalidAt && Date.now() - checked < LOCAL_TTL_MS) return
  localChecked.set(key, Date.now())
  const fresh = (row: { at: Date } | null) => !!row && Date.now() - row.at.getTime() < GEN_TTL_MS && row.at.getTime() > invalidAt
  const where = { unitId_day: { unitId, day: dbDate(d) } }
  if (fresh(await db.homeCareGeneration.findUnique({ where }))) return
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(unitId)}))`
    if (fresh(await tx.homeCareGeneration.findUnique({ where }))) return
    const startedAt = new Date()
    await generateVisits(tx, unitId, d)
    await tx.homeCareGeneration.upsert({ where, update: { at: startedAt }, create: { unitId, day: dbDate(d), at: startedAt } })
  }, { timeout: 60_000, maxWait: 30_000 })
}

async function generateVisits(tx: Prisma.TransactionClient, unitId: string, day: Date) {
  const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { orgId: true, kind: true } })
  if (!unit || !isHomecare(unit)) return
  const residents = await tx.resident.findMany({ where: { unitId, status: 'active' }, select: { id: true } })
  if (!residents.length) return
  const templates = await tx.homeCareTemplate.findMany({ where: { orgId: unit.orgId, active: true, residentId: { in: residents.map((r) => r.id) }, startDate: { lte: dbDate(day) } } })
  if (!templates.length) return
  const date = dbDate(day)
  const [existing, absences, dayVisits] = await Promise.all([
    tx.homeCareVisit.findMany({ where: { templateId: { in: templates.map((t) => t.id) }, date }, select: { templateId: true } }),
    tx.absence.findMany({ where: { userId: { in: templates.map((t) => t.preferredUserId).filter((x): x is string => !!x) }, status: 'approved', from: { lte: date }, to: { gte: date } }, select: { userId: true } }),
    tx.homeCareVisit.findMany({ where: { unitId, date }, select: { assigneeId: true, sequence: true } }),
  ])
  const rows = visitsForDay(
    templates.map((t) => ({ ...t, startDate: fromDbDate(t.startDate), endDate: t.endDate ? fromDbDate(t.endDate) : null })),
    day,
    { existing: new Set(existing.map((e) => e.templateId!)), activeResidents: new Set(residents.map((r) => r.id)), unavailable: new Set(absences.map((a) => a.userId)) },
  )
  const byTpl = new Map(templates.map((t) => [t.id, t]))
  for (const r of appendSequences(dayVisits, rows)) {
    await tx.homeCareVisit.create({
      data: {
        orgId: unit.orgId, unitId, residentId: r.residentId, templateId: r.templateId, date, plannedStart: r.plannedStart, plannedEnd: r.plannedEnd,
        assigneeId: r.assigneeId, sequence: r.sequence, note: byTpl.get(r.templateId)?.note ?? null, createdById: byTpl.get(r.templateId)?.createdById ?? null,
        services: { create: r.services.map((s, i) => ({ klv: s.klv, label: s.label, plannedMin: s.minutes, order: i })) },
      },
    })
  }
}

// ───────── Daten für Disposition und Tour ─────────

const visitInclude = { services: { orderBy: { order: 'asc' } } } satisfies Prisma.HomeCareVisitInclude
export type VisitRow = Prisma.HomeCareVisitGetPayload<{ include: typeof visitInclude }>

const residentSelect = {
  id: true, firstName: true, lastName: true, birthDate: true, status: true, allergies: true, street: true, postalCode: true, city: true, phone: true, unitId: true,
  accessNote: true,
} satisfies Prisma.ResidentSelect

/** Mitarbeitende des Einsatzgebiets: Spitex-Durchführung mit Rolle im Gebiet/Standort oder Stammbereich hier. */
export async function spitexStaff(orgId: string, unit: { id: string; locationId: string }, extraIds: string[] = []) {
  const rows = await db.roleAssignment.findMany({
    where: { role: { orgId, permissions: { has: 'spitex.document' } }, user: { active: true, orgId } },
    select: { userId: true, unitId: true, locationId: true, user: { select: { primaryUnitId: true } } },
  })
  const ids = new Set(extraIds)
  for (const r of rows) {
    if (r.unitId === unit.id || r.locationId === unit.locationId || (!r.unitId && !r.locationId && r.user.primaryUnitId === unit.id)) ids.add(r.userId)
  }
  if (!ids.size) return []
  return db.user.findMany({
    where: { id: { in: [...ids] }, orgId },
    select: { id: true, firstName: true, lastName: true, initials: true, jobTitle: true, phone: true, workPhone: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
}

/**
 * Belegung der Personen ausserhalb der Spitex an einem Tag: genehmigte Abwesenheiten und Dienste auf Stationen
 * (auch Nachtdienst vom Vortag). Dienste im Einsatzgebiet selbst sind keine Konflikte.
 */
export async function busyFor(orgId: string, userIds: string[], day: Date, t: Ctx['t']): Promise<Map<string, Busy[]>> {
  const out = new Map<string, Busy[]>()
  if (!userIds.length) return out
  const date = dbDate(day)
  const [absences, shifts] = await Promise.all([
    db.absence.findMany({ where: { userId: { in: userIds }, status: 'approved', from: { lte: date }, to: { gte: date } } }),
    db.shift.findMany({
      where: { userId: { in: userIds }, date: { in: [date, dbDate(addDays(day, -1))] }, status: { not: 'cancelled' }, unit: { orgId, kind: { not: 'homecare' } } },
      include: { shiftType: { select: { code: true, start: true, end: true } }, unit: { select: { name: true, shortName: true } } },
    }),
  ])
  const push = (id: string, b: Busy) => out.set(id, [...(out.get(id) ?? []), b])
  for (const a of absences) push(a.userId, absenceBusy(fromDbDate(a.from), fromDbDate(a.to), t('spitex.conflict.absenceKind.' + a.kind)))
  for (const s of shifts) if (s.userId) push(s.userId, shiftBusy(fromDbDate(s.date), s.shiftType.start, s.shiftType.end, `${s.shiftType.code} · ${s.unit.shortName ?? s.unit.name}`))
  return out
}

/** Tagesplan eines Einsatzgebiets: Einsätze mit Leistungen, Personen, Mitarbeitende und Konflikthinweise. */
export async function dayBoard(ctx: Ctx, unit: { id: string; locationId: string }, day: Date) {
  await ensureVisitsForDay(unit.id, day).catch((e) => log.warn('homecare.generate_failed', { error: e instanceof Error ? e.message : String(e) }))
  const date = dbDate(day)
  const visits = await db.homeCareVisit.findMany({ where: { orgId: ctx.org.id, unitId: unit.id, date }, include: visitInclude, orderBy: [{ sequence: 'asc' }, { plannedStart: 'asc' }] })
  const residents = await db.resident.findMany({
    where: { orgId: ctx.org.id, OR: [{ unitId: unit.id, status: { in: ['active', 'absent'] } }, { id: { in: visits.map((v) => v.residentId) } }] },
    select: residentSelect,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  const staff = await spitexStaff(ctx.org.id, unit, visits.map((v) => v.assigneeId).filter((x): x is string => !!x))
  const busy = await busyFor(ctx.org.id, staff.map((s) => s.id), day, ctx.t)
  const conflicts = new Map<string, Conflict[]>()
  for (const s of staff) {
    const mine = visits.filter((v) => v.assigneeId === s.id)
    for (const [id, c] of visitConflicts(mine, busy.get(s.id) ?? [])) conflicts.set(id, c)
  }
  const rOf = (id: string) => residents.find((r) => r.id === id)
  return {
    visits,
    open: tourOrder(visits.filter((v) => !v.assigneeId)),
    tours: staff.map((s) => ({ user: s, visits: tourOrder(visits.filter((v) => v.assigneeId === s.id)), busy: busy.get(s.id) ?? [] })),
    residents: residents.map(({ accessNote, ...r }) => ({ ...r, hasAccess: !!accessNote })),
    staff,
    conflicts,
    rOf,
  }
}

/** Meine Tour: heutige Einsätze der Person (alle Einsatzgebiete mit Durchführungsrecht) in Tourreihenfolge. */
export async function myTour(ctx: Ctx, day = new Date()) {
  const units = spitexUnits(ctx, 'spitex.document')
  if (!units.length) return { units, visits: [] as VisitRow[], residents: [] as ((Omit<Prisma.ResidentGetPayload<{ select: typeof residentSelect }>, 'accessNote'>) & { hasAccess: boolean })[] }
  for (const u of units) await ensureVisitsForDay(u.id, day).catch((e) => log.warn('homecare.generate_failed', { error: e instanceof Error ? e.message : String(e) }))
  const visits = await db.homeCareVisit.findMany({
    where: { orgId: ctx.org.id, unitId: { in: units.map((u) => u.id) }, date: dbDate(day), assigneeId: ctx.user.id, status: { not: 'cancelled' } },
    include: visitInclude,
  })
  const residents = await db.resident.findMany({ where: { orgId: ctx.org.id, id: { in: visits.map((v) => v.residentId) } }, select: residentSelect })
  return { units, visits: tourOrder(visits), residents: residents.map(({ accessNote, ...r }) => ({ ...r, hasAccess: !!accessNote })) }
}

/** Einsätze eines Monats (Leistungsnachweis); nur abgeschlossene zählen in den Summen. */
export async function monthVisits(orgId: string, unitIds: string[], start: Date, end: Date, residentId?: string) {
  return db.homeCareVisit.findMany({
    where: { orgId, unitId: { in: unitIds }, date: { gte: dbDate(start), lt: dbDate(end) }, ...(residentId ? { residentId } : {}), status: 'done' },
    include: visitInclude,
    orderBy: [{ date: 'asc' }, { actualStart: 'asc' }],
  })
}

export const isToday = (d: Date) => sameDay(d, new Date())
