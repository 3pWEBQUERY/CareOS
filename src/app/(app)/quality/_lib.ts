import 'server-only'
import type { IncidentStage, Prisma } from '@prisma/client'
import type { Ctx } from '@/lib/context'
import type { TFn } from '@/i18n/core'
import { INCIDENT_TYPES, type WorkflowStep } from '@/lib/clinical-config'

/** Ereignis-Workflow (PRD §22): Ereignis → Sofortmassnahmen → Bewertung → Follow-up → Analyse → Abschluss. */
export const STAGES: IncidentStage[] = ['reported', 'immediate', 'assessment', 'followup', 'analysis', 'closed']
export const stageIndex = (s: IncidentStage) => STAGES.indexOf(s)
/** Stufen, die nur mit quality.manage erreicht oder bearbeitet werden dürfen. */
export const MANAGE_STAGES: IncidentStage[] = ['assessment', 'followup', 'analysis', 'closed']
export const SEVERITIES = ['none', 'minor', 'moderate', 'severe'] as const

/** Bereiche, in denen der Benutzer Ereignisse sehen darf (melden oder bearbeiten). */
export function qualityUnits(ctx: Ctx) {
  return ctx.units.filter((u) => {
    const scope = { unitId: u.id, locationId: u.locationId }
    return ctx.can('quality.report', scope) || ctx.can('quality.manage', scope)
  })
}
export const canManageUnit = (ctx: Ctx, unit: { id: string; locationId: string }) => ctx.can('quality.manage', { unitId: unit.id, locationId: unit.locationId })

/** Folgeprozess eines Ereignistyps. Fehlt der Schlüssel in der DB-Konfiguration, wird die Standardkonfiguration herangezogen. */
export function workflowSteps(type: { key: string; workflow: Prisma.JsonValue }): WorkflowStep[] {
  const fallback = INCIDENT_TYPES.find((x) => x.key === type.key)?.workflow ?? []
  const raw = Array.isArray(type.workflow) ? (type.workflow as unknown[]) : []
  return raw
    .map((s, i) => {
      const o = (s ?? {}) as Partial<WorkflowStep>
      const key = o.key ?? fallback.find((f) => f.title === o.title)?.key ?? `step${i + 1}`
      return {
        key,
        title: o.title ?? key,
        category: o.category ?? 'Qualität',
        offsetMin: Number(o.offsetMin) || 0,
        durationMin: Number(o.durationMin) || 10,
      }
    })
}

/** Titel einer Massnahme: Systemschritte tragen den Schlüssel `incident.<step>`. */
export function actionTitle(t: TFn, title: string) {
  if (title.startsWith('incident.')) return t('quality.workflow.' + title.slice(9))
  return title
}

// ───────── Aggregation (Muster) ─────────
// Reine Musterlogik (ohne Datenbank, testbar) liegt in src/lib/quality-patterns.ts.
export { timeBucket, TIME_BUCKETS, placeKind, PLACE_KINDS, patternHints, type TimeBucket, type PlaceKind, type Hint } from '@/lib/quality-patterns'
import { timeBucket, placeKind } from '@/lib/quality-patterns'

type AggIncident = { occurredAt: Date; place: string | null; severity: string; nearMiss: boolean; residentId: string | null; type: { key: string; name: string } }

/** Anonymisierte Kennzahlen für den Quality Assistant: nur Zählungen, keine Namen, keine Zimmernummern, keine Freitexte. */
export function anonymisedAggregates(rows: AggIncident[], from: Date | null, to: Date) {
  const count = <K extends string>(f: (r: AggIncident) => K) => rows.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {})
  const perResident = count((r) => r.residentId ?? '-')
  delete perResident['-']
  const repeat = Object.values(perResident).filter((n) => n >= 2).length
  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  return {
    zeitraum: { von: from ? from.toISOString().slice(0, 10) : null, bis: to.toISOString().slice(0, 10) },
    total: rows.length,
    nachTyp: count((r) => r.type.name),
    nachTageszeit: count((r) => ({ night: 'Nacht 22–6', morning: 'Morgen 6–11', midday: 'Tag 11–17', evening: 'Abend 17–22' })[timeBucket(r.occurredAt)]),
    nachWochentag: count((r) => weekdays[r.occurredAt.getDay()]),
    nachOrt: count((r) => placeKind(r.place)),
    nachSchweregrad: count((r) => r.severity),
    beinaheEreignisse: rows.filter((r) => r.nearMiss).length,
    personenMitMehrerenEreignissen: repeat,
    personenMitEreignis: Object.keys(perResident).length,
  }
}

export function median(values: number[]) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Datum/Zeit im Format YYYY-MM-DDTHH:MM (DateTimeField) in Stationszeit. */
export function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
