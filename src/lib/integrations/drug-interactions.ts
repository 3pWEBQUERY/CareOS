/**
 * Schnittstelle Interaktionsprüfung (PRD §13.1, §40, §58) – vorbereitet, ohne angebundene Datenquelle.
 *
 * Eine medizinische Datenquelle (in der Schweiz z. B. HCI Solutions/Documedis oder Compendium-Daten) wird als
 * Adapter mit `DrugInteractionProvider` angebunden und unter Administration › Schnittstellen als Integration
 * `drug_interactions` mit `config.provider = '<id>'` aktiviert. Solange kein Adapter registriert ist, liefert der
 * Leerlauf-Provider ausdrücklich «keine Datenquelle angebunden» – nie «keine Interaktionen».
 *
 * Datenschutz: an einen Adapter gehen nur Wirkstoffe/Produkte (Name, optional ATC/GTIN), keine Personendaten.
 */

export type InteractionSeverity = 'contraindicated' | 'major' | 'moderate' | 'minor'

export type DrugRef = { id?: string; name: string; atc?: string | null; gtin?: string | null }

export type Interaction = {
  /** Beteiligte Medikamente (Namen wie verordnet) */
  drugs: [string, string]
  severity: InteractionSeverity
  /** Kurzbeschreibung der Datenquelle (Sprache der Quelle) */
  text: string
  /** Empfohlenes Vorgehen laut Quelle, falls vorhanden */
  management?: string
}

export type InteractionResult =
  | { status: 'checked'; source: string; checkedAt: string; interactions: Interaction[] }
  /** Keine Datenquelle angebunden oder Datenquelle nicht erreichbar: Prüfung hat NICHT stattgefunden. */
  | { status: 'unavailable'; source: string | null; reason: 'not_configured' | 'no_adapter' | 'error'; checkedAt: string }

export interface DrugInteractionProvider {
  /** Schlüssel in Integration.config.provider */
  readonly id: string
  readonly name: string
  check(drugs: DrugRef[], opts: { locale: string; signal?: AbortSignal }): Promise<InteractionResult>
}

/** Leerlauf: keine Datenquelle. Gibt nie eine Entwarnung. */
export const unavailableProvider = (reason: 'not_configured' | 'no_adapter', source: string | null = null): DrugInteractionProvider => ({
  id: 'none',
  name: source ?? '–',
  async check() {
    return { status: 'unavailable', source, reason, checkedAt: new Date().toISOString() }
  },
})

/** Registrierte Adapter. Neue Datenquellen hier eintragen (je Adapter eine Datei in lib/integrations/). */
const ADAPTERS: Record<string, (config: Record<string, unknown>) => DrugInteractionProvider> = {}

export function registerInteractionAdapter(id: string, factory: (config: Record<string, unknown>) => DrugInteractionProvider) {
  ADAPTERS[id] = factory
}

/**
 * Provider zu einer Integration (oder keiner). Ohne aktive Integration → `not_configured`; Integration ohne
 * passenden Adapter → `no_adapter` (konfiguriert, aber nicht ausführbar – wird so angezeigt, nicht als «verbunden»).
 */
export function providerFor(integration: { name: string; active: boolean; config: unknown } | null | undefined): DrugInteractionProvider {
  if (!integration?.active) return unavailableProvider('not_configured')
  const cfg = (integration.config ?? {}) as Record<string, unknown>
  const id = typeof cfg.provider === 'string' ? cfg.provider : ''
  const factory = ADAPTERS[id]
  if (!factory) return unavailableProvider('no_adapter', integration.name)
  return factory(cfg)
}

/** Prüfung mit Zeitlimit; Fehler des Adapters werden als «nicht verfügbar» gemeldet, nie als «keine Interaktionen». */
export async function checkInteractions(provider: DrugInteractionProvider, drugs: DrugRef[], locale: string, timeoutMs = 4000): Promise<InteractionResult> {
  if (drugs.length < 2 && provider.id !== 'none') return { status: 'checked', source: provider.name, checkedAt: new Date().toISOString(), interactions: [] }
  try {
    return await provider.check(drugs, { locale, signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    return { status: 'unavailable', source: provider.name, reason: 'error', checkedAt: new Date().toISOString() }
  }
}

export const SEVERITY_ORDER: InteractionSeverity[] = ['contraindicated', 'major', 'moderate', 'minor']
