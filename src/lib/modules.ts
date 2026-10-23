/**
 * Module je Organisation (PRD §69 Commercial Product Structure, §45). Rein, ohne Server-Abhängigkeiten.
 *
 * Wirkung zentral über die Berechtigungen: `getCtx()` entfernt die Berechtigungen abgeschalteter Module aus den
 * Grants (`stripDisabled`). Navigation, Seiten, Server Actions, Suche und Befehlspalette folgen damit automatisch.
 * API-Tokens: `apiAuth()` prüft Scope und Pfad (`moduleOfApiPath`). Seiten eines abgeschalteten Moduls zeigen
 * «Modul nicht aktiv» (`moduleOfPath`, Shell `ModuleGate`).
 *
 * «core» (Identität, Organisation, Sicherheit, Admin) und die Pflege-Grundfunktionen (Akte, Planung, Verlauf,
 * Aufgaben, Übergabe, Vitalwerte) sind immer aktiv.
 */

/** §69-Pakete – für Anzeige und Gruppierung. */
export const MODULE_PACKAGES = ['workforce', 'clinical_plus', 'quality', 'intelligence', 'portals'] as const
export type ModulePackage = (typeof MODULE_PACKAGES)[number]

type ModuleDef = {
  key: string
  pkg: ModulePackage
  /** Berechtigungen (exakt oder Präfix mit abschliessendem Punkt), die nur mit aktivem Modul gelten */
  perms: readonly string[]
  /** Seitenpfade (Präfix; `*` = ein Pfadsegment) */
  paths: readonly string[]
  /** API-Pfade (Präfix) */
  api?: readonly string[]
}

export const MODULES = [
  { key: 'schedule', pkg: 'workforce', perms: ['schedule.'], paths: ['/schedule'] },
  { key: 'chat', pkg: 'workforce', perms: ['chat.'], paths: ['/chat'] },
  { key: 'docs', pkg: 'workforce', perms: ['docs.'], paths: ['/docs'] },
  { key: 'learn', pkg: 'workforce', perms: ['learn.'], paths: ['/learn'] },
  { key: 'medication', pkg: 'clinical_plus', perms: ['resident.medication.'], paths: ['/tasks/medround', '/residents/*/meds'], api: ['/api/fhir/MedicationStatement'] },
  { key: 'visit', pkg: 'clinical_plus', perms: ['resident.visit.'], paths: ['/tasks/visit'] },
  // Paket Ä: Therapie (Physio/Ergo/Logo, PRD §60) – bestehende Organisationen per Datenmigration aktiv
  { key: 'therapy', pkg: 'clinical_plus', perms: ['therapy.'], paths: ['/therapy'] },
  { key: 'quality', pkg: 'quality', perms: ['quality.'], paths: ['/quality'] },
  { key: 'insights', pkg: 'quality', perms: ['insights.'], paths: ['/insights'] },
  { key: 'ai', pkg: 'intelligence', perms: ['ai.'], paths: [] },
  { key: 'dictation', pkg: 'intelligence', perms: ['resident.chart.dictate'], paths: [] },
  { key: 'portals', pkg: 'portals', perms: ['portal.'], paths: ['/team/family', '/portal'] },
] as const satisfies readonly ModuleDef[]

export type ModuleKey = (typeof MODULES)[number]['key']
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[]

/**
 * Paketnamen aus §69 als Alias (Vertrag mit anderen Paketen, z. B. `orgHasModule(org, 'clinical_plus')` für
 * Medikamentenaufgaben). «core» und «nursing» sind immer aktiv.
 */
const ALIASES: Record<string, ModuleKey | 'core'> = { core: 'core', nursing: 'core', clinical_plus: 'medication', intelligence: 'ai' }

/** Gespeicherte Liste bereinigen: nur bekannte Schlüssel, ohne Doppelte, in fester Reihenfolge. */
export function normalizeModules(list: readonly string[] | null | undefined): ModuleKey[] {
  const set = new Set(list ?? [])
  return MODULE_KEYS.filter((k) => set.has(k))
}

type OrgLike = { modules?: readonly string[] | null } | readonly string[] | null | undefined

const listOf = (org: OrgLike): readonly string[] => (Array.isArray(org) ? org : ((org as { modules?: readonly string[] | null } | null)?.modules ?? MODULE_KEYS))

/** Ist das Modul (oder der §69-Paketname) für die Organisation aktiv? Ohne Angabe gilt: alle aktiv. */
export function orgHasModule(org: OrgLike, key: ModuleKey | 'core' | 'nursing' | 'clinical_plus' | 'intelligence' | 'workforce' | 'portals'): boolean {
  if (key === 'workforce') return MODULES.some((m) => m.pkg === 'workforce' && listOf(org).includes(m.key))
  const k = ALIASES[key] ?? key
  if (k === 'core') return true
  return listOf(org).includes(k)
}

const permMatches = (rule: string, perm: string) => (rule.endsWith('.') ? perm.startsWith(rule) : perm === rule)

/** Modul, an das eine Berechtigung gebunden ist (null = Kern, immer aktiv). */
export function moduleOfPermission(perm: string): ModuleKey | null {
  for (const m of MODULES) if (m.perms.some((r) => permMatches(r, perm))) return m.key
  return null
}

/** Berechtigungen abgeschalteter Module entfernen. */
export function stripDisabled(perms: readonly string[], enabled: readonly string[]): string[] {
  const on = new Set(enabled)
  return perms.filter((p) => {
    const m = moduleOfPermission(p)
    return !m || on.has(m)
  })
}

function pathMatches(pattern: string, path: string) {
  const a = pattern.split('/').filter(Boolean)
  const b = path.split('?')[0].split('/').filter(Boolean)
  if (b.length < a.length) return false
  return a.every((seg, i) => seg === '*' || seg === b[i])
}

/** Modul einer Seite (Präfix-Abgleich), null = immer verfügbar. */
export function moduleOfPath(path: string | null | undefined): ModuleKey | null {
  if (!path) return null
  for (const m of MODULES) if (m.paths.some((p) => pathMatches(p, path))) return m.key
  return null
}

/** Modul eines API-Pfads, null = immer verfügbar. */
export function moduleOfApiPath(path: string): ModuleKey | null {
  for (const m of MODULES as readonly ModuleDef[]) if (m.api?.some((p) => path === p || path.startsWith(p + '/'))) return m.key as ModuleKey
  return null
}

/** Module ein-/ausschalten, Ergebnis normalisiert. */
export function setModule(list: readonly string[], key: ModuleKey, on: boolean): ModuleKey[] {
  const set = new Set(normalizeModules(list))
  if (on) set.add(key)
  else set.delete(key)
  return MODULE_KEYS.filter((k) => set.has(k))
}
