import 'server-only'
import type { Prisma, Task } from '@prisma/client'
import { db } from '@/lib/db'
import { addDays, addMinutes, atTime, dateKey, startOfDay } from '@/lib/time'
import { dueView } from '@/lib/task-view'

export type TaskView = 'done' | 'partial' | 'skipped' | 'escalated' | 'over' | 'due' | 'up' | 'in_progress'

/** Anzeigezustand einer Aufgabe. Überfällig ab 15 Min. nach Fälligkeit, "jetzt fällig" 30 Min. davor. */
export function taskView(t: Pick<Task, 'status' | 'dueAt'>, now = new Date()): TaskView {
  if (t.status === 'done' || t.status === 'partial' || t.status === 'skipped' || t.status === 'escalated' || t.status === 'in_progress') return t.status
  return dueView(t.dueAt, now)
}
export const isClosed = (s: Task['status']) => s === 'done' || s === 'partial' || s === 'skipped'
export const OPEN_STATUSES = ['planned', 'ready', 'in_progress', 'escalated'] as const

const generated = new Map<string, number>()
/** Nach Änderungen an Pflegeplanung oder Medikation aufrufen, damit Aufgaben neu erzeugt werden. */
export function invalidateTaskGeneration(unitId?: string) {
  if (!unitId) generated.clear()
  else for (const k of generated.keys()) if (k.startsWith(unitId + ':')) generated.delete(k)
}

/**
 * Erzeugt die Aufgaben eines Tages aus Pflegeplanung (Interventionen), Medikamentenplan und fälligen Assessments
 * (PRD §12.1). Idempotent über den Unique-Key (source, sourceId, dueAt).
 */
export async function ensureTasksForDay(unitId: string, day = new Date()) {
  const key = unitId + ':' + dateKey(day)
  const last = generated.get(key)
  if (last && Date.now() - last < 10 * 60_000) return
  generated.set(key, Date.now())

  const unit = await db.unit.findUnique({ where: { id: unitId }, select: { orgId: true } })
  if (!unit) return
  const wd = day.getDay()
  const residents = await db.resident.findMany({
    where: { unitId, status: 'active' },
    select: {
      id: true,
      interventions: { where: { active: true } },
      medications: { where: { active: true, kind: { not: 'prn' }, startDate: { lte: addDays(startOfDay(day), 1) } } },
      assessments: { where: { nextDue: { gte: startOfDay(day), lt: addDays(startOfDay(day), 1) } }, orderBy: { at: 'desc' } },
    },
  })
  const rows: Prisma.TaskCreateManyInput[] = []
  for (const r of residents) {
    for (const iv of r.interventions) {
      if (iv.weekdays.length && !iv.weekdays.includes(wd)) continue
      for (const time of iv.times) {
        rows.push({
          orgId: unit.orgId, unitId, residentId: r.id, title: iv.title, description: iv.instructions, category: iv.category,
          dueAt: atTime(day, time), durationMin: iv.durationMin, source: 'careplan', sourceId: iv.id,
        })
      }
    }
    const slots = new Set<string>()
    for (const m of r.medications) {
      if (m.endDate && m.endDate < startOfDay(day)) continue
      m.times.forEach((time, i) => {
        // Kein Zeitpunkt vor Beginn der Verordnung (z. B. Verordnung um 23:50 erfasst → kein 21:00-Slot).
        if (m.doses[i] && m.doses[i] !== '0' && atTime(day, time) >= m.startDate) slots.add(time)
      })
    }
    for (const time of slots) {
      rows.push({
        orgId: unit.orgId, unitId, residentId: r.id, title: 'medication.slot', category: 'Medikation',
        dueAt: atTime(day, time), durationMin: 5, source: 'medication', sourceId: `${r.id}:${time}`,
      })
    }
    for (const a of r.assessments) {
      if (!a.nextDue) continue
      rows.push({
        orgId: unit.orgId, unitId, residentId: r.id, title: 'assessment.' + a.key, category: 'Assessment',
        dueAt: a.nextDue < startOfDay(day) || (a.nextDue.getHours() === 0 && a.nextDue.getMinutes() === 0) ? atTime(day, '10:00') : a.nextDue, /* Fälligkeit ohne Uhrzeit → 10:00 statt Mitternacht */ durationMin: 15, source: 'assessment', sourceId: `${r.id}:${a.key}`,
        priority: 'important',
      })
    }
  }
  if (rows.length) await db.task.createMany({ data: rows, skipDuplicates: true })
}

export async function overdueCount(unitId: string, now = new Date()) {
  await ensureTasksForDay(unitId, now)
  return db.task.count({
    where: { unitId, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addMinutes(now, -15) } },
  })
}
