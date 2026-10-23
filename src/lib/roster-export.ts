/**
 * Monatsexport der Stunden für die Lohnbuchhaltung (PRD §19, Leitung mit schedule.manage) – reine Logik, testbar.
 * Zahlen aus der Regelprüfung der Monatsplanung (`evaluate` in src/lib/roster), damit Export und Raster übereinstimmen:
 * Soll = Arbeitstage × Tages-Soll × Pensum, Geplant = Dienststunden (ohne Pause) plus gutgeschriebene Abwesenheiten.
 */
import { cellKey } from '@/lib/roster/model'
import type { PersonStats } from '@/lib/roster/evaluate'

export const ABSENCE_KINDS = ['vacation', 'sick', 'training', 'compensation', 'other'] as const
export type AbsenceKind = (typeof ABSENCE_KINDS)[number]

/** Genehmigte Abwesenheitstage im Monat je Art (Kalendertage). */
export function absenceDays(days: string[], absenceAt: Record<string, { kind: string; status: string }>, userId: string): Record<AbsenceKind, number> {
  const out = Object.fromEntries(ABSENCE_KINDS.map((k) => [k, 0])) as Record<AbsenceKind, number>
  for (const d of days) {
    const a = absenceAt[cellKey(userId, d)]
    if (!a || a.status !== 'approved') continue
    const k = (ABSENCE_KINDS as readonly string[]).includes(a.kind) ? (a.kind as AbsenceKind) : 'other'
    out[k]++
  }
  return out
}

export type PayrollHeader = { person: string; employeeNo: string; pct: string; soll: string; ist: string; diff: string; nights: string; weekends: string; absence: (kind: AbsenceKind) => string }

const h = (n: number) => n.toFixed(2)

/** Tabelle für toCsv: Kopfzeile und eine Zeile je Person (Reihenfolge wie übergeben). */
export function payrollRows(
  header: PayrollHeader,
  people: { id: string; name: string; employeeNo: string | null; pct: number }[],
  stats: Record<string, PersonStats>,
  days: string[],
  absenceAt: Record<string, { kind: string; status: string }>,
): string[][] {
  return [
    [header.person, header.employeeNo, header.pct, header.soll, header.ist, header.diff, header.nights, header.weekends, ...ABSENCE_KINDS.map(header.absence)],
    ...people.map((p) => {
      const s = stats[p.id]
      const abs = absenceDays(days, absenceAt, p.id)
      return [
        p.name, p.employeeNo ?? '', String(p.pct),
        h(s?.soll ?? 0), h(s?.ist ?? 0), h(s?.diff ?? 0), String(s?.nights ?? 0), String(s?.weekends ?? 0),
        ...ABSENCE_KINDS.map((k) => String(abs[k])),
      ]
    }),
  ]
}
