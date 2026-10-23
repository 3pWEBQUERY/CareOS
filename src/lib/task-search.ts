/**
 * Globale Suche nach Aufgaben (PRD §24): Systemaufgaben tragen Schlüssel als Titel («medication.slot»,
 * «assessment.braden», «rule.bradenRisk» …, siehe taskTitle). Damit sie über ihren angezeigten Text gefunden
 * werden, wird die Suchanfrage hier gegen die übersetzten Titel und Kategorien geprüft und in Datenbank-Bedingungen
 * (exakte Titel, Präfixe, Kategorien) übersetzt. Rein, ohne Datenbank – Server und Tests.
 */
import type { TFn } from '@/i18n/core'
import { ASSESSMENTS, CARE_DOMAINS } from '@/lib/clinical-config'
import { IV_CATEGORIES } from '@/lib/care'
import { WORKFLOW_RULES } from '@/lib/workflow-rules'
import { ORDER_KINDS } from '@/lib/visit'

/** Schritte der Ereignis-Workflows mit übersetztem Titel (quality.workflow.*). */
const INCIDENT_STEPS = ['vitals', 'assessment', 'physician', 'careplan', 'followup', 'wound', 'debrief'] as const
/** Systemkategorien, die nicht aus der Pflegeplanung stammen (gespeicherter Wert → Schlüssel in tasks.categories). */
export const SYS_TASK_CATEGORIES: Record<string, string> = { Assessment: 'assessment', Organisation: 'organisation', Planung: 'planning', Qualität: 'quality' }

/** Kleinschreibung ohne Akzente (é → e, ü → u), wie in der Combobox-Suche. */
export const normText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export type TaskSearchWhere = { titles: string[]; prefixes: string[]; categories: string[] }

/** Welche Systemtitel und Kategorien passen zur Anfrage q (in der Sprache von t)? */
export function systemTaskMatches(t: TFn, q: string): TaskSearchWhere {
  const needle = normText(q.trim())
  const out: TaskSearchWhere = { titles: [], prefixes: [], categories: [] }
  if (needle.length < 2) return out
  const hit = (label: string) => normText(label).includes(needle)
  if (hit(t('tasks.medSlot'))) out.titles.push('medication.slot')
  // Allgemeiner Teil («Assessment fällig») trifft alle Assessments, sonst einzeln nach Instrument.
  if (hit(t('tasks.assessmentDue', { name: '' }).trim())) out.prefixes.push('assessment.')
  else for (const a of ASSESSMENTS) if (hit(t('care.assessments.names.' + a.key))) out.titles.push('assessment.' + a.key)
  if (hit(t('tasks.evaluationDue', { name: '' }).trim())) out.prefixes.push('evaluation.')
  else for (const d of CARE_DOMAINS) if (hit(t('care.domains.' + d.key))) out.titles.push('evaluation.' + d.key)
  for (const r of WORKFLOW_RULES) if (hit(t('tasks.rules.' + r + '.task'))) out.titles.push('rule.' + r)
  for (const s of INCIDENT_STEPS) if (hit(t('quality.workflow.' + s))) out.titles.push('incident.' + s)
  for (const k of ORDER_KINDS) if (hit(t('visit.task.' + k))) out.titles.push('visit.order.' + k)
  for (const c of IV_CATEGORIES) if (hit(t('care.categories.' + c.key)) || hit(c.value)) out.categories.push(c.value)
  for (const [value, key] of Object.entries(SYS_TASK_CATEGORIES)) if (hit(t('tasks.categories.' + key)) || hit(value)) out.categories.push(value)
  return out
}

/** Treffer je Person und angezeigtem Titel bündeln (die nächste offene Fälligkeit zuerst), höchstens `limit`. */
export function dedupeTaskHits<T extends { residentId: string | null; label: string }>(rows: T[], limit: number) {
  const seen = new Map<string, { row: T; n: number }>()
  for (const r of rows) {
    const k = (r.residentId ?? '-') + '\u0000' + r.label
    const cur = seen.get(k)
    if (cur) cur.n++
    else if (seen.size < limit) seen.set(k, { row: r, n: 1 })
  }
  return [...seen.values()]
}
