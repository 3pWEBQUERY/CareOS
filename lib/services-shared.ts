// Leistungserfassung: erbrachte Pflegeleistungen mit Zeit, Katalog der Einrichtung und Monatsauswertung.
import { TASK_CATEGORIES } from "@/lib/tasks-shared";

export const SERVICE_CATEGORIES = TASK_CATEGORIES;

export const SERVICE_SOURCES = {
  manual: "Direkt erfasst",
  task: "Aus Aufgabe",
  intervention: "Aus Massnahme",
} as const;
export type ServiceSource = keyof typeof SERVICE_SOURCES;

export const MAX_SERVICE_MINUTES = 720;

export type ServiceCatalogItem = {
  id: string;
  name: string;
  category: string;
  code: string;
  defaultMinutes: number | null;
  active: boolean;
};

export type ServiceRecord = {
  id: string;
  title: string;
  category: string;
  code: string;
  minutes: number;
  performedAt: string;
  performedBy: string;
  source: ServiceSource;
  note: string;
  cancelledAt: string | null;
  cancelReason: string;
};

// Vorschläge für die Erfassung: erledigte Aufgaben des Tages ohne Leistung und laufende Massnahmen der Pflegeplanung.
export type ServiceSuggestion = {
  source: Exclude<ServiceSource, "manual">;
  sourceId: string;
  title: string;
  category: string;
  detail: string;
  // Passender Katalogeintrag (gleiche Bezeichnung), falls vorhanden.
  catalogId: string | null;
  performedAt: string | null;
};

export type ServiceDay = {
  residentId: string;
  day: string;
  canWrite: boolean;
  records: ServiceRecord[];
  suggestions: ServiceSuggestion[];
  catalog: ServiceCatalogItem[];
};

export type ServiceReportResident = {
  id: string;
  name: string;
  room: string;
  careUnit: string;
  minutes: number;
  count: number;
  byCategory: Record<string, number>;
};

export type ServiceReportRow = {
  residentName: string;
  performedAt: string;
  title: string;
  category: string;
  code: string;
  minutes: number;
  performedBy: string;
  source: ServiceSource;
};

export type ServiceReport = {
  month: string;
  careUnitId: string | null;
  minutes: number;
  count: number;
  categories: string[];
  residents: ServiceReportResident[];
  rows: ServiceReportRow[];
};

// Minuten als „2 h 05 min“ bzw. „45 min“.
export function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

// Monat „JJJJ-MM“ prüfen; ungültig: null.
export function parseMonth(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return value;
}
