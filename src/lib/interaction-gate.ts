/**
 * Interaktionsprüfung im Verordnungsdialog (PRD §13.1, §32): bewertet das Ergebnis des Adapters
 * (src/lib/integrations/drug-interactions.ts) für ein neues bzw. geändertes Medikament. Reine Logik.
 *
 * - Ohne Datenquelle oder bei Fehler: «nicht geprüft» – nie eine Entwarnung, Speichern bleibt möglich.
 * - Kontraindiziert: Speichern nur mit Begründung (wird protokolliert).
 * - Schwerwiegend/mittel: deutlicher Hinweis, kein Blockieren.
 */
import { SEVERITY_ORDER, type DrugRef, type Interaction, type InteractionResult } from '@/lib/integrations/drug-interactions'

export type GateLevel = 'unavailable' | 'clear' | 'minor' | 'moderate' | 'major' | 'contraindicated'

export type Gate = {
  level: GateLevel
  /** Treffer, an denen das neue Medikament beteiligt ist (nach Schwere sortiert) */
  hits: Interaction[]
  needsReason: boolean
  source: string | null
  reason?: 'not_configured' | 'no_adapter' | 'error'
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Liste für den Adapter: das neue Medikament zuerst, dann die übrigen aktiven Verordnungen (ohne die ersetzte). */
export function drugList(draft: DrugRef, active: (DrugRef & { id: string })[], replacesId?: string | null): DrugRef[] {
  return [draft, ...active.filter((m) => m.id !== replacesId).map(({ id, name, atc, gtin }) => ({ id, name, atc: atc ?? null, gtin: gtin ?? null }))]
}

export function gate(result: InteractionResult, draftName: string): Gate {
  if (result.status !== 'checked') return { level: 'unavailable', hits: [], needsReason: false, source: result.source, reason: result.reason }
  const hits = result.interactions
    .filter((x) => x.drugs.some((d) => same(d, draftName)))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
  const level: GateLevel = hits[0]?.severity ?? 'clear'
  return { level, hits, needsReason: level === 'contraindicated', source: result.source }
}

/** Begründung bei «kontraindiziert» ausreichend? (mind. 5 Zeichen, wie beim Allergie-Abgleich) */
export const reasonOk = (g: Gate, reason: string) => !g.needsReason || reason.trim().length >= 5
