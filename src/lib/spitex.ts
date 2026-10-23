/**
 * Spitex-Grundlage (PRD §60 Phase 6, §40) – nur vorbereitet, noch ohne Oberfläche und ohne Schemaänderung.
 *
 * Ambulante Pflege nutzt dieselben Bausteine wie die Station: Bereich (Unit) mit `kind = 'homecare'` als Einsatzgebiet,
 * Person mit Terminologie «Klient/in» (Organization.terminology = client), Aufgaben als Einsätze. Für die Umsetzung
 * vorgesehen (Paket K, Schema additiv): Resident.address/accessNote (Einsatzort, Zugang, Schlüssel), HomeCareVisit
 * (Start/Ende, Person, Leistungen), HomeCareService (KLV-Leistung, Minuten) und ein Leistungsnachweis je Monat über
 * src/lib/billing.ts. Tagesroute mobil mit der bestehenden Offline-Outbox (src/lib/offline/).
 */
export const UNIT_KINDS = ['ward', 'homecare'] as const
export type UnitKind = (typeof UNIT_KINDS)[number]
export const isHomecare = (u: { kind?: string | null } | null | undefined) => u?.kind === 'homecare'

/**
 * Leistungen nach KLV Art. 7 Abs. 2 (Krankenpflege-Leistungsverordnung): a = Abklärung, Beratung und Koordination,
 * b = Untersuchung und Behandlung, c = Grundpflege. Schlüssel stabil, Anzeige später über i18n `spitex.klv.*`.
 */
export const KLV_CATEGORIES = [
  { key: 'a', de: 'Abklärung, Beratung und Koordination' },
  { key: 'b', de: 'Untersuchung und Behandlung' },
  { key: 'c', de: 'Grundpflege' },
] as const
export type KlvCategory = (typeof KLV_CATEGORIES)[number]['key']

/** Zuordnung der bestehenden Aufgabenkategorien (Pflegeplanung) zu KLV-Kategorien für den Leistungsnachweis. */
export const KLV_BY_TASK_CATEGORY: Record<string, KlvCategory> = {
  Grundpflege: 'c', Ernährung: 'c', Mobilität: 'c', Aktivierung: 'c',
  Behandlungspflege: 'b', Medikation: 'b', Überwachung: 'b',
  Assessment: 'a', Planung: 'a', Organisation: 'a',
}
export const klvOf = (category: string): KlvCategory | null => KLV_BY_TASK_CATEGORY[category] ?? null
