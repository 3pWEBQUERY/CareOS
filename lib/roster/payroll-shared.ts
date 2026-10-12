// Lohnarten der Einrichtung für den Lohn-Export: welcher Wert der Monatsauswertung unter welcher Nummer an die
// Lohnbuchhaltung geht. Geteilt zwischen Server und Oberfläche.
import type { AbsenceKind } from "./types";

export const WAGE_SOURCES = [
  "ACTUAL_HOURS",
  "TARGET_HOURS",
  "BALANCE_HOURS",
  "NIGHT_HOURS",
  "WEEKEND_HOURS",
  "HOLIDAY_HOURS",
  "VACATION_DAYS",
  "SICK_DAYS",
  "TRAINING_DAYS",
  "OTHER_ABSENCE_DAYS",
] as const;
export type WageSource = (typeof WAGE_SOURCES)[number];

export const WAGE_SOURCE_LABELS: Record<WageSource, string> = {
  ACTUAL_HOURS: "Ist-Stunden",
  TARGET_HOURS: "Soll-Stunden",
  BALANCE_HOURS: "Saldo (Stunden)",
  NIGHT_HOURS: "Nachtstunden",
  WEEKEND_HOURS: "Wochenendstunden",
  HOLIDAY_HOURS: "Feiertagsstunden",
  VACATION_DAYS: "Urlaub (Tage)",
  SICK_DAYS: "Krank (Tage)",
  TRAINING_DAYS: "Fortbildung (Tage)",
  OTHER_ABSENCE_DAYS: "Abwesend (Tage)",
};

export const wageUnit = (source: WageSource) => (source.endsWith("_DAYS") ? "Tage" : "Stunden");

export const WAGE_SOURCE_ABSENCE: Partial<Record<WageSource, AbsenceKind>> = {
  VACATION_DAYS: "VACATION",
  SICK_DAYS: "SICK",
  TRAINING_DAYS: "TRAINING",
  OTHER_ABSENCE_DAYS: "OTHER",
};

export type WageType = { id: string; code: string; name: string; source: WageSource };

// Menge einer Lohnart aus der Monatsauswertung einer Person (Stunden mit zwei Nachkommastellen bzw. Tage).
export function wageQuantity(
  source: WageSource,
  row: {
    targetMinutes: number;
    actualMinutes: number;
    balanceMinutes: number;
    nightMinutes: number;
    weekendMinutes: number;
    holidayMinutes: number;
    absenceDays: Record<string, number>;
  },
) {
  const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
  const absence = WAGE_SOURCE_ABSENCE[source];
  if (absence) return row.absenceDays[absence] ?? 0;
  switch (source) {
    case "ACTUAL_HOURS":
      return hours(row.actualMinutes);
    case "TARGET_HOURS":
      return hours(row.targetMinutes);
    case "BALANCE_HOURS":
      return hours(row.balanceMinutes);
    case "NIGHT_HOURS":
      return hours(row.nightMinutes);
    case "WEEKEND_HOURS":
      return hours(row.weekendMinutes);
    case "HOLIDAY_HOURS":
    default:
      return hours(row.holidayMinutes);
  }
}
