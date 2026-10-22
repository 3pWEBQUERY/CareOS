import 'server-only'
import type { Prisma, Task } from '@prisma/client'
import { db } from '@/lib/db'
import { addDays, addMinutes, atTime, dateKey, fromDbDate, sameDay, startOfDay } from '@/lib/time'
import { dueView } from '@/lib/task-view'
import { LIVE } from '@/lib/vitals'
import { ASSESSMENTS, CARE_DOMAINS } from '@/lib/clinical-config'
import { occursOn } from '@/lib/recurrence'
import { applyWorkflowRules } from '@/lib/workflows'

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

/** Uhrzeit, zu der fällige Evaluationen der Pflegeplanung als Aufgabe erscheinen (ruhigere Tageszeit). */
export const EVALUATION_TIME = '14:00'
/** Fällige Evaluationen so weit zurück noch als Aufgabe anlegen (z. B. nach einem Wochenende ohne Aufruf). */
const EVALUATION_LOOKBACK_DAYS = 7
const STD_ASSESSMENTS = new Set(ASSESSMENTS.map((a) => a.key))
const STD_DOMAINS = new Set<string>(CARE_DOMAINS.map((d) => d.key))
/** Systemtitel mit Namen für organisationseigene Schlüssel: «assessment.<key>:<Name>» (siehe taskTitle). */
const keyTitle = (prefix: string, key: string, std: Set<string>, name?: string | null) => prefix + key + (std.has(key) || !name ? '' : ':' + name.replace(/[\r\n]+/g, ' ').slice(0, 120))
const workflowRun = new Map<string, number>()

/**
 * Erzeugt die Aufgaben eines Tages aus Pflegeplanung (Interventionen und fällige Evaluationen), Medikamentenplan,
 * fälligen Assessments und wiederkehrenden Aufgaben (PRD §12.1). Idempotent über den Unique-Key (source, sourceId, dueAt).
 * Für heute laufen zusätzlich die Smart-Workflow-Regeln (PRD §48, höchstens alle 2 Minuten je Bereich).
 */
export async function ensureTasksForDay(unitId: string, day = new Date()) {
  const now = new Date()
  if (sameDay(day, now) && Date.now() - (workflowRun.get(unitId) ?? 0) > 2 * 60_000) {
    workflowRun.set(unitId, Date.now())
    const u = await db.unit.findUnique({ where: { id: unitId }, select: { orgId: true } })
    if (u) await applyWorkflowRules(u.orgId, [unitId], now).catch((e) => console.error('[workflows]', e))
  }
  const key = unitId + ':' + dateKey(day)
  const last = generated.get(key)
  if (last && Date.now() - last < 10 * 60_000) return
  generated.set(key, Date.now())

  const unit = await db.unit.findUnique({ where: { id: unitId }, select: { orgId: true } })
  if (!unit) return
  const wd = day.getDay()
  const dayStart = startOfDay(day)
  const [residents, defs, domains, templates] = await Promise.all([
    db.resident.findMany({
      where: { unitId, status: 'active' },
      select: {
        id: true,
        interventions: { where: { active: true } },
        medications: { where: { active: true, kind: { not: 'prn' }, startDate: { lte: addDays(dayStart, 1) } } },
        assessments: { where: { nextDue: { gte: dayStart, lt: addDays(dayStart, 1) }, ...LIVE }, orderBy: { at: 'desc' } },
        carePlans: {
          where: { status: 'active' },
          select: { areas: { where: { evaluateBy: { gte: addDays(dayStart, -EVALUATION_LOOKBACK_DAYS), lt: addDays(dayStart, 1) } }, select: { domain: true, evaluateBy: true } } },
        },
      },
    }),
    db.assessmentDefinition.findMany({ where: { orgId: unit.orgId }, select: { key: true, name: true, active: true } }),
    db.careDomain.findMany({ where: { orgId: unit.orgId }, select: { key: true, name: true } }),
    db.taskTemplate.findMany({ where: { unitId, active: true, startDate: { lte: addDays(dayStart, 1) } } }),
  ])
  const defByKey = new Map(defs.map((d) => [d.key, d]))
  const domainName = new Map(domains.map((d) => [d.key, d.name]))
  const activeIds = new Set(residents.map((r) => r.id))
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
      // Deaktivierte Instrumente erzeugen keine Aufgaben mehr.
      if (defs.length && defByKey.get(a.key)?.active === false) continue
      rows.push({
        orgId: unit.orgId, unitId, residentId: r.id, title: keyTitle('assessment.', a.key, STD_ASSESSMENTS, defByKey.get(a.key)?.name), category: 'Assessment',
        dueAt: a.nextDue < startOfDay(day) || (a.nextDue.getHours() === 0 && a.nextDue.getMinutes() === 0) ? atTime(day, '10:00') : a.nextDue, /* Fälligkeit ohne Uhrzeit → 10:00 statt Mitternacht */ durationMin: 15, source: 'assessment', sourceId: `${r.id}:${a.key}`,
        priority: 'important',
      })
    }
    // Fällige Evaluationen der Pflegeplanung (PRD §9.2): eine Aufgabe je Pflegebereich und Fälligkeitstag.
    for (const area of r.carePlans.flatMap((p) => p.areas)) {
      if (!area.evaluateBy) continue
      rows.push({
        orgId: unit.orgId, unitId, residentId: r.id, title: keyTitle('evaluation.', area.domain, STD_DOMAINS, domainName.get(area.domain)), category: 'Planung',
        dueAt: atTime(area.evaluateBy, EVALUATION_TIME), durationMin: 20, source: 'careplan', sourceId: `eval:${r.id}:${area.domain}`, priority: 'routine',
      })
    }
  }
  // Wiederkehrende Aufgaben (Vorlagen aus Aufgaben bzw. Admin → Klinische Konfiguration)
  for (const tpl of templates) {
    if (tpl.residentId && !activeIds.has(tpl.residentId)) continue
    const rec = { rhythm: tpl.rhythm, every: tpl.every, weekdays: tpl.weekdays, monthDay: tpl.monthDay, startDate: fromDbDate(tpl.startDate), endDate: tpl.endDate ? fromDbDate(tpl.endDate) : null }
    if (!occursOn(rec, day)) continue
    for (const time of tpl.times) {
      // Zeiten, die beim Anlegen oder Ändern der Vorlage schon vorbei waren, nicht nachträglich als überfällig erzeugen.
      if (atTime(day, time) < tpl.updatedAt) continue
      rows.push({
        orgId: unit.orgId, unitId, residentId: tpl.residentId, title: tpl.title, description: tpl.description, category: tpl.category,
        dueAt: atTime(day, time), durationMin: tpl.durationMin, priority: tpl.priority, assigneeId: tpl.assigneeId, createdById: tpl.createdById,
        source: 'recurring', sourceId: tpl.id,
      })
    }
  }
  if (rows.length) await db.task.createMany({ data: rows, skipDuplicates: true })
}

/**
 * Ereignis-Massnahmen (PRD §22) folgen ihrer verknüpften Aufgabe: abgeschlossen (erledigt/teilweise) → erledigt,
 * wieder offen → offen. Aufruf nach jeder Statusänderung von Aufgaben; der Eskalationsjob gleicht zusätzlich ab.
 */
export async function syncIncidentActions(taskIds: string[]) {
  if (!taskIds.length) return 0
  const actions = await db.incidentAction.findMany({ where: { taskId: { in: taskIds } }, select: { id: true, taskId: true, doneAt: true } })
  if (!actions.length) return 0
  const tasks = await db.task.findMany({ where: { id: { in: actions.map((a) => a.taskId!) } }, select: { id: true, status: true, completedAt: true, completedById: true } })
  let n = 0
  for (const a of actions) {
    const k = tasks.find((x) => x.id === a.taskId)
    if (!k) continue
    const done = k.status === 'done' || k.status === 'partial'
    if (done && !a.doneAt) n += (await db.incidentAction.updateMany({ where: { id: a.id, doneAt: null }, data: { doneAt: k.completedAt ?? new Date(), doneById: k.completedById } })).count
    else if (!done && a.doneAt) n += (await db.incidentAction.updateMany({ where: { id: a.id, doneAt: { not: null } }, data: { doneAt: null, doneById: null } })).count
  }
  return n
}

/** Abgleich der Massnahmen offener Ereignisse (Status über Tagesplan, Offline-Synchronisation oder API geändert). */
export async function reconcileIncidentActions() {
  const actions = await db.incidentAction.findMany({ where: { taskId: { not: null }, incident: { stage: { not: 'closed' } } }, select: { taskId: true } })
  return syncIncidentActions(actions.map((a) => a.taskId!))
}

export async function overdueCount(unitId: string, now = new Date()) {
  await ensureTasksForDay(unitId, now)
  return db.task.count({
    where: { unitId, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addMinutes(now, -15) } },
  })
}
