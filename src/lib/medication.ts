import 'server-only'
import type { Medication, MedicationAdministration, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { addDays, addMinutes, atTime, startOfDay, toMin } from '@/lib/time'

/**
 * CareOS Med (PRD §13): gemeinsame Logik für Abgabeliste, Medikamentenrunde, Station und Übergabe.
 * Abgaben werden nie geändert oder gelöscht: Korrektur = Storno (voidedAt) + neuer Eintrag.
 */

export const DEFAULT_SLOTS = ['07:30', '12:00', '17:30', '21:00']
/** Überfällig, wenn eine Dosis 60 Min. nach dem geplanten Zeitpunkt noch offen ist. */
export const OVERDUE_MIN = 60
/** Wirkungskontrolle nach Reservemedikation. */
export const EFFECT_CHECK_MIN = 45

export type SlotKey = 'morning' | 'noon' | 'evening' | 'night'
export function slotKey(time: string): SlotKey {
  const m = toMin(time)
  if (m >= 240 && m < 600) return 'morning'
  if (m >= 600 && m < 840) return 'noon'
  if (m >= 840 && m < 1140) return 'evening'
  return 'night'
}

export const hasDose = (d: string | null | undefined) => !!d && d.trim() !== '' && d.trim() !== '0'

/** Anzahl Einheiten für den Bestand ("1", "2 Tbl.", "1 Hub"). Mengen wie "10 ml" oder "18 IE" zählen nicht. */
export function doseUnits(d: string | null | undefined): number | null {
  if (!d) return null
  const m = d.trim().match(/^(\d+)(?:\s*(?:Tbl|Kps|Stk|Btl|Hub|Hübe|Tube|Supp|Amp|Kautbl|Lutschtbl)\.?(?:\s.*)?)?$/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

type MedTimes = Pick<Medication, 'startDate' | 'stoppedAt' | 'endDate' | 'active'>
/** Gilt die Verordnung zum Zeitpunkt? Enddatum ist inklusiv (ganzer Tag). */
export function medAppliesAt(m: MedTimes, at: Date) {
  if (at < m.startDate) return false
  if (m.stoppedAt && at >= m.stoppedAt) return false
  if (!m.active && !m.stoppedAt) return false
  if (m.endDate && at >= addDays(startOfDay(m.endDate), 1)) return false
  return true
}

/** Verordnungen (ohne Reserve), die am Tag gelten oder an dem Tag abgesetzt wurden. */
export function scheduledMedsWhere(day: Date): Prisma.MedicationWhereInput {
  const from = startOfDay(day)
  const to = addDays(from, 1)
  return {
    kind: { not: 'prn' },
    startDate: { lt: to },
    OR: [{ stoppedAt: null, active: true }, { stoppedAt: { gte: from } }],
    AND: [{ OR: [{ endDate: null }, { endDate: { gte: from } }] }],
  }
}

export type DoseState = 'open' | 'given' | 'refused' | 'omitted' | 'held'

export type Cell = {
  time: string
  at: Date
  dose: string
  applicable: boolean
  admin: MedicationAdministration | null
  state: DoseState
  over: boolean
}

/** Zellen einer Verordnung für die Zeitpunkte eines Tages. */
export function cellsFor(m: Medication, slots: string[], day: Date, admins: MedicationAdministration[], now = new Date()): (Cell | null)[] {
  return slots.map((time) => {
    const i = m.times.indexOf(time)
    const dose = i >= 0 ? m.doses[i] ?? '' : ''
    const at = atTime(day, time)
    const admin = admins.filter((a) => a.medicationId === m.id && a.scheduledFor?.getTime() === at.getTime() && !a.voidedAt).sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null
    const applicable = hasDose(dose) && medAppliesAt(m, at)
    if (!applicable && !admin) return null
    const state: DoseState = admin ? admin.status : 'open'
    return { time, at, dose, applicable, admin, state, over: state === 'open' && now > addMinutes(at, OVERDUE_MIN) }
  })
}

/** Verschiedene Zeitpunkte mit Dosis, sortiert. */
export function slotsOf(meds: Pick<Medication, 'times' | 'doses'>[]) {
  const s = new Set<string>()
  for (const m of meds) m.times.forEach((t, i) => hasDose(m.doses[i]) && s.add(t))
  return [...s].sort((a, b) => toMin(a) - toMin(b))
}

/** Tägliche Einheiten einer Dauerverordnung (für Reichweite). */
export function dailyUnits(m: Pick<Medication, 'doses'>) {
  let n = 0
  for (const d of m.doses) n += doseUnits(d) ?? 0
  return n
}

/** Reichweite in Tagen; null, wenn nicht berechenbar. */
export function stockDays(m: Medication): number | null {
  if (m.stock == null) return null
  if (m.kind === 'prn') return null
  const d = dailyUnits(m)
  if (!d) return null
  return Math.floor(m.stock / d)
}
export function lowStock(m: Medication) {
  if (m.stock == null) return false
  if (m.kind === 'prn') return m.stock <= Math.max(3, m.prnMaxPerDay ?? 0)
  const d = stockDays(m)
  return d != null && d < 7
}

/** Reserve: Abgaben der letzten 24 h, letzter Zeitpunkt, frühester nächster Zeitpunkt. */
export function prnStatus(m: Medication, admins: MedicationAdministration[], now = new Date()) {
  const given = admins.filter((a) => a.medicationId === m.id && !a.voidedAt && a.status === 'given' && a.scheduledFor == null).sort((a, b) => b.at.getTime() - a.at.getTime())
  const since = new Date(now.getTime() - 24 * 3600_000)
  const count24 = given.filter((a) => a.at >= since).length
  const last = given[0] ?? null
  const nextAllowed = last && m.prnMinIntervalH ? new Date(last.at.getTime() + m.prnMinIntervalH * 3600_000) : null
  const full = m.prnMaxPerDay != null && count24 >= m.prnMaxPerDay
  return { count24, last, nextAllowed: nextAllowed && nextAllowed > now ? nextAllowed : null, full }
}

/**
 * Offene Dosen (mehr als 60 Min. nach Zeitpunkt nicht dokumentiert) für mehrere Personen an einem Tag.
 * Grundlage für "Medikamente offen" (Station), Übergabe und Startseite.
 */
export async function openDoses(residentIds: string[], day = new Date(), now = new Date(), opts: { from?: Date; to?: Date; includeUpcoming?: boolean } = {}) {
  if (!residentIds.length) return []
  const from = startOfDay(day)
  const [meds, admins] = await Promise.all([
    db.medication.findMany({ where: { residentId: { in: residentIds }, ...scheduledMedsWhere(day) } }),
    db.medicationAdministration.findMany({ where: { residentId: { in: residentIds }, scheduledFor: { gte: from, lt: addDays(from, 1) }, voidedAt: null } }),
  ])
  const out: { residentId: string; medication: Medication; time: string; at: Date; dose: string; over: boolean }[] = []
  for (const m of meds) {
    const cells = cellsFor(m, slotsOf([m]), day, admins, now)
    for (const c of cells) {
      if (!c || !c.applicable || c.state !== 'open') continue
      if (opts.from && c.at < opts.from) continue
      if (opts.to && c.at >= opts.to) continue
      if (!c.over && !opts.includeUpcoming) continue
      out.push({ residentId: m.residentId, medication: m, time: c.time, at: c.at, dose: c.dose, over: c.over })
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}

/**
 * Hält die Medikamenten-Aufgabe eines Zeitpunkts (source 'medication', sourceId `${residentId}:${time}`) synchron:
 * alle Dosen dokumentiert → erledigt; wieder unvollständig → offen; keine gültige Verordnung mehr → übersprungen.
 * Gibt die Statusänderung zurück (für emit).
 */
export async function syncSlotTask(
  r: { id: string; orgId: string; unitId: string },
  day: Date,
  time: string,
  actorId: string,
  skippedNote: string,
): Promise<'completed' | 'reopened' | 'skipped' | null> {
  const at = atTime(day, time)
  const meds = await db.medication.findMany({ where: { residentId: r.id, ...scheduledMedsWhere(day) } })
  const applicable = meds.filter((m) => {
    const i = m.times.indexOf(time)
    return i >= 0 && hasDose(m.doses[i]) && medAppliesAt(m, at)
  })
  const admins = await db.medicationAdministration.findMany({ where: { residentId: r.id, scheduledFor: at, voidedAt: null } })
  const documented = new Set(admins.map((a) => a.medicationId))
  const complete = applicable.length > 0 && applicable.every((m) => documented.has(m.id))
  const sourceId = `${r.id}:${time}`
  let task = await db.task.findFirst({ where: { source: 'medication', sourceId, dueAt: at } })
  if (!task) {
    if (!applicable.length) return null
    task = await db.task.create({
      data: { orgId: r.orgId, unitId: r.unitId, residentId: r.id, title: 'medication.slot', category: 'Medikation', dueAt: at, durationMin: 5, source: 'medication', sourceId },
    })
  }
  const closed = task.status === 'done' || task.status === 'partial' || task.status === 'skipped'
  if (complete && !closed) {
    await db.task.update({ where: { id: task.id }, data: { status: 'done', completedById: actorId, completedAt: new Date() } })
    return 'completed'
  }
  if (!applicable.length && !closed) {
    await db.task.update({ where: { id: task.id }, data: { status: 'skipped', completedById: actorId, completedAt: new Date(), note: skippedNote } })
    return 'skipped'
  }
  if (!complete && applicable.length && closed) {
    await db.task.update({ where: { id: task.id }, data: { status: 'planned', completedById: null, completedAt: null, note: null } })
    return 'reopened'
  }
  return null
}
