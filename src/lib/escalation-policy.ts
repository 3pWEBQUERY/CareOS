/**
 * Eskalationsregeln (PRD §45 Workflow – Eskalationen) – reine Logik, auf Server und Client nutzbar.
 * Rollen werden über ihren Schlüssel (Role.key) referenziert.
 */
export type EscalationPolicy = {
  enabled: boolean
  taskOverdueMinutes: number
  criticalTaskOverdueMinutes: number
  taskNotifyRoles: string[]
  vitalsAbnormalNotifyRoles: string[]
  incidentSevereNotifyRoles: string[]
  unackedImportantHandoverMinutes: number
}

export const DEFAULT_ESCALATION: EscalationPolicy = {
  enabled: true,
  taskOverdueMinutes: 60,
  taskNotifyRoles: ['ward_lead'],
  criticalTaskOverdueMinutes: 15,
  vitalsAbnormalNotifyRoles: ['ward_lead'],
  incidentSevereNotifyRoles: ['nursing_director'],
  unackedImportantHandoverMinutes: 120,
}

export const ESCALATION_LIMITS = {
  taskOverdueMinutes: { min: 15, max: 1440 },
  criticalTaskOverdueMinutes: { min: 5, max: 240 },
  unackedImportantHandoverMinutes: { min: 30, max: 1440 },
} as const

/** Nur so weit zurück wird eskaliert, damit beim Einschalten keine Flut alter Aufgaben entsteht. */
export const ESCALATION_LOOKBACK_HOURS = 24

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def
}
const roleList = (v: unknown, def: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[\w-]{1,40}$/.test(x)))] : def)

/** Liest Organization.settings.escalation mit Standardwerten und Grenzen. */
export function escalationPolicy(settings: unknown): EscalationPolicy {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).escalation : null
  const raw = (s && typeof s === 'object' && !Array.isArray(s) ? s : {}) as Record<string, unknown>
  const d = DEFAULT_ESCALATION
  const L = ESCALATION_LIMITS
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    taskOverdueMinutes: clampInt(raw.taskOverdueMinutes, d.taskOverdueMinutes, L.taskOverdueMinutes.min, L.taskOverdueMinutes.max),
    criticalTaskOverdueMinutes: clampInt(raw.criticalTaskOverdueMinutes, d.criticalTaskOverdueMinutes, L.criticalTaskOverdueMinutes.min, L.criticalTaskOverdueMinutes.max),
    taskNotifyRoles: roleList(raw.taskNotifyRoles, d.taskNotifyRoles),
    vitalsAbnormalNotifyRoles: roleList(raw.vitalsAbnormalNotifyRoles, d.vitalsAbnormalNotifyRoles),
    incidentSevereNotifyRoles: roleList(raw.incidentSevereNotifyRoles, d.incidentSevereNotifyRoles),
    unackedImportantHandoverMinutes: clampInt(raw.unackedImportantHandoverMinutes, d.unackedImportantHandoverMinutes, L.unackedImportantHandoverMinutes.min, L.unackedImportantHandoverMinutes.max),
  }
}

/** Schwelle in Minuten nach Fälligkeit: kritische Aufgaben eskalieren früher. */
export const overdueThreshold = (priority: string, p: EscalationPolicy) => (priority === 'critical' ? p.criticalTaskOverdueMinutes : p.taskOverdueMinutes)

const ESCALATABLE = new Set(['planned', 'ready', 'in_progress'])

/**
 * Planungsarbeit ohne Zeitdruck wird nicht automatisch eskaliert: fällige Evaluationen der Pflegeplanung
 * (sourceId «eval:…») erscheinen als überfällig und in Insights («Evaluationen überfällig»).
 */
export const isPlanningTask = (task: { source?: string; sourceId?: string | null }) => task.source === 'careplan' && !!task.sourceId?.startsWith('eval:')

/** Muss diese Aufgabe jetzt eskaliert werden? (offen, überfällig über der Schwelle, nicht älter als der Rückblick) */
export function shouldEscalateTask(task: { status: string; priority: string; dueAt: Date; source?: string; sourceId?: string | null }, p: EscalationPolicy, now = new Date()) {
  if (!p.enabled || !ESCALATABLE.has(task.status) || isPlanningTask(task)) return false
  const overdueMin = (now.getTime() - task.dueAt.getTime()) / 60_000
  return overdueMin >= overdueThreshold(task.priority, p) && overdueMin <= ESCALATION_LOOKBACK_HOURS * 60
}

/** Früheste Fälligkeit, ab der Aufgaben in Frage kommen (für die Datenbankabfrage). */
export const escalationWindow = (p: EscalationPolicy, now = new Date()) => ({
  from: new Date(now.getTime() - ESCALATION_LOOKBACK_HOURS * 3600_000),
  to: new Date(now.getTime() - Math.min(p.taskOverdueMinutes, p.criticalTaskOverdueMinutes) * 60_000),
})
