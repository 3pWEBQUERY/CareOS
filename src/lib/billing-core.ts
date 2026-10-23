/**
 * Leistungserfassung und Abrechnungsexport (PRD §40 Abrechnung) – reine Rechenregeln, ohne Datenbank.
 *
 * - Aufenthaltstage: Kalendertage im Monat zwischen Eintritt und Austritt (Eintritts- und Austrittstag zählen).
 * - Abwesenheitstage: Nächte ausserhalb (Tage zwischen Beginn und Rückkehr, ohne Abreise- und Rückkehrtag),
 *   aus den Pflegeepisoden «absence». Laufende Abwesenheit zählt bis Monatsende.
 * - Pflegeminuten: Summe der geplanten Dauer quittierter Aufgaben (erledigt oder teilweise) im Monat – dokumentierte
 *   Leistungen, keine Zeitmessung. Pflegestufe: aktueller Stand der Stammdaten.
 * - Spitex (Einsatzgebiete): erbrachte Minuten je KLV-Kategorie a/b/c aus abgeschlossenen Einsätzen (src/lib/spitex.ts).
 */
export const monthRange = (key: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null
  const start = new Date(Number(m[1]), Number(m[2]) - 1, 1)
  const end = new Date(Number(m[1]), Number(m[2]), 1)
  return { start, end }
}

const DAY = 86_400_000
const dayIndex = (d: Date) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / DAY)

/** Kalendertage von a bis b (beide eingeschlossen), begrenzt auf den Monat [start, end). */
export function daysWithin(a: Date, b: Date | null, start: Date, end: Date) {
  const from = Math.max(dayIndex(a), dayIndex(start))
  const to = Math.min(dayIndex(b ?? new Date(end.getTime() - 1)), dayIndex(new Date(end.getTime() - 1)))
  return Math.max(0, to - from + 1)
}

/** Nächte zwischen Abreise und Rückkehr im Monat (Abreise- und Rückkehrtag gelten als anwesend). */
export function absenceNights(a: Date, b: Date | null, start: Date, end: Date) {
  const first = dayIndex(a) + 1
  const last = b ? dayIndex(b) - 1 : dayIndex(new Date(end.getTime() - 1))
  const from = Math.max(first, dayIndex(start))
  const to = Math.min(last, dayIndex(new Date(end.getTime() - 1)))
  return Math.max(0, to - from + 1)
}

export type BillingRow = {
  lastName: string; firstName: string; birthDate: string; insuranceNo: string | null; unit: string; careLevel: number | null
  stayDays: number; absenceDays: number; careMinutes: number; services: number; byCategory: Record<string, number>
  /** Spitex: Minuten je KLV-Kategorie (nur Personen mit Einsätzen im Monat) */
  klv?: { a: number; b: number; c: number }
}

/**
 * CSV-Zeilen (Kopf + Daten); Kategorien als eigene Spalten in fester Reihenfolge. KLV-Spalten (a, b, c) nur, wenn
 * im Export Spitex-Einsätze vorkommen und `header.klv` gesetzt ist.
 */
export function billingCsvRows(rows: BillingRow[], header: { base: string[]; category: (c: string) => string; klv?: (k: 'a' | 'b' | 'c') => string }) {
  const cats = [...new Set(rows.flatMap((r) => Object.keys(r.byCategory)))].sort()
  const klv = header.klv && rows.some((r) => r.klv) ? (['a', 'b', 'c'] as const) : []
  return [
    [...header.base, ...cats.map(header.category), ...klv.map((k) => header.klv!(k))],
    ...rows.map((r) => [
      r.lastName, r.firstName, r.birthDate, r.insuranceNo ?? '', r.unit, r.careLevel != null ? String(r.careLevel) : '',
      String(r.stayDays), String(r.absenceDays), String(r.careMinutes), (r.careMinutes / 60).toFixed(2), String(r.services),
      ...cats.map((c) => String(r.byCategory[c] ?? 0)),
      ...klv.map((k) => String(r.klv?.[k] ?? 0)),
    ]),
  ]
}
