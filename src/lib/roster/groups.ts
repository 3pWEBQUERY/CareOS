/**
 * Gruppen im Monatsplan wie im PEP: Mitarbeitende nach Funktion bzw. Ausbildungsstufe. Erkannt aus Qualifikation
 * und Funktionsbezeichnung (Schweizer Abschlüsse: HF/FH, FaGe EFZ, AGS EBA, SRK); Studierende und Lernende am Ende.
 * Unbekannte Qualifikationen bilden eine eigene Gruppe mit ihrem Namen. Rein, auf Server und Client nutzbar.
 */
export const STAFF_GROUPS = ['lead', 'hf', 'fage', 'ags', 'srk', 'students', 'apprentices', 'other'] as const
export type StaffGroup = (typeof STAFF_GROUPS)[number]

const RULES: [StaffGroup, RegExp][] = [
  ['students', /studier|student|\bin ausbildung hf\b|étudiant|studente/i],
  ['apprentices', /lernend|lehrling|auszubild|\bin ausbildung\b|apprenti|apprendist|trainee/i],
  ['lead', /leitung|leiter|\blead\b|responsable|capo/i],
  ['hf', /\bHF\b|\bFH\b|pflegefach|dipl\.|infirmi|infermier|registered nurse/i],
  ['fage', /\bfage\b|fach(frau|mann|person) gesundheit|\bEFZ\b|\bASSC\b|\bOSS\b/i],
  ['ags', /\bags\b|assistent(in)? gesundheit|\bEBA\b|\bASA\b/i],
  ['srk', /\bsrk\b|\bcrs\b|\bcri\b|pflegehelf|auxiliaire|ausiliari|care assistant/i],
]

/** Gruppe einer Person; `custom` = Name einer nicht erkannten Qualifikation (eigene Gruppe). */
export function staffGroup(qual: string, job: string): { group: StaffGroup; custom?: string } {
  const text = `${qual} ${job}`
  for (const [g, re] of RULES) if (re.test(text)) return { group: g }
  return qual ? { group: 'other', custom: qual } : { group: 'other' }
}

/** Personen nach Gruppe (feste Reihenfolge, eigene Qualifikationen nach Stufe vor «Weitere») und Name ordnen. */
export function groupStaff<T extends { name: string; qual: string; job: string; level: number }>(people: T[]) {
  const withGroup = people.map((p) => ({ ...p, ...staffGroup(p.qual, p.job) }))
  const rank = (x: (typeof withGroup)[number]) => {
    const i = STAFF_GROUPS.indexOf(x.group)
    // eigene Qualifikationen nach Stufe zwischen SRK und Studierenden einreihen
    return x.custom ? STAFF_GROUPS.indexOf('srk') + 0.5 - x.level / 100 : i
  }
  return withGroup.sort((a, b) => rank(a) - rank(b) || (a.custom ?? '').localeCompare(b.custom ?? '') || a.name.localeCompare(b.name, 'de'))
}

/** Bereits zugeordnete Personen (Gruppe ggf. manuell festgelegt) in Gruppenreihenfolge und nach Name ordnen. */
export function sortByGroup<T extends { name: string; level: number; group: StaffGroup; custom?: string }>(people: T[]) {
  const rank = (x: T) => (x.custom ? STAFF_GROUPS.indexOf('srk') + 0.5 - x.level / 100 : STAFF_GROUPS.indexOf(x.group))
  return [...people].sort((a, b) => rank(a) - rank(b) || (a.custom ?? '').localeCompare(b.custom ?? '') || a.name.localeCompare(b.name, 'de'))
}
