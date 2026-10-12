// Grunddaten einer Organisation (auch in Migration 0023 für bestehende Organisationen angelegt).
// Regelwerk-Werte sind Beispielwerte nach Schweizer ArG und müssen von der Leitung bestätigt werden.
import { COUNTRIES } from "@/lib/country";
import type { AbsenceKind, ShiftCategory } from "./types";

// Qualifikationen der Schweiz (Standard); andere Länder: lib/country.ts.
export const DEFAULT_QUALIFICATIONS = COUNTRIES.CH.qualifications;

export const DEFAULT_SHIFT_TYPES: Array<{
  name: string;
  code: string;
  category: ShiftCategory;
  absenceKind: AbsenceKind | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  color: string;
  workTimeFactor: number;
  creditsTarget: boolean;
  sortOrder: number;
}> = [
  {
    name: "Frühdienst",
    code: "F",
    category: "WORK",
    absenceKind: null,
    startTime: "07:00",
    endTime: "15:30",
    breakMinutes: 30,
    color: "#2563eb",
    workTimeFactor: 1,
    creditsTarget: false,
    sortOrder: 10,
  },
  {
    name: "Zwischendienst",
    code: "Z",
    category: "WORK",
    absenceKind: null,
    startTime: "08:00",
    endTime: "16:30",
    breakMinutes: 30,
    color: "#0f766e",
    workTimeFactor: 1,
    creditsTarget: false,
    sortOrder: 20,
  },
  {
    name: "Spätdienst",
    code: "S",
    category: "WORK",
    absenceKind: null,
    startTime: "13:30",
    endTime: "22:00",
    breakMinutes: 30,
    color: "#b45309",
    workTimeFactor: 1,
    creditsTarget: false,
    sortOrder: 30,
  },
  {
    name: "Nachtdienst",
    code: "N",
    category: "WORK",
    absenceKind: null,
    startTime: "21:45",
    endTime: "07:15",
    breakMinutes: 30,
    color: "#4338ca",
    workTimeFactor: 1,
    creditsTarget: false,
    sortOrder: 40,
  },
  {
    name: "Bereitschaft",
    code: "B",
    category: "STANDBY",
    absenceKind: null,
    startTime: "07:00",
    endTime: "19:00",
    breakMinutes: 0,
    color: "#64748b",
    workTimeFactor: 1,
    creditsTarget: false,
    sortOrder: 50,
  },
  {
    name: "Rufbereitschaft",
    code: "R",
    category: "ON_CALL",
    absenceKind: null,
    startTime: "19:00",
    endTime: "07:00",
    breakMinutes: 0,
    color: "#7c3aed",
    workTimeFactor: 0,
    creditsTarget: false,
    sortOrder: 60,
  },
  {
    name: "Urlaub",
    code: "U",
    category: "ABSENCE",
    absenceKind: "VACATION",
    startTime: "08:00",
    endTime: "16:24",
    breakMinutes: 0,
    color: "#15803d",
    workTimeFactor: 1,
    creditsTarget: true,
    sortOrder: 70,
  },
  {
    name: "Krank",
    code: "K",
    category: "ABSENCE",
    absenceKind: "SICK",
    startTime: "08:00",
    endTime: "16:24",
    breakMinutes: 0,
    color: "#be123c",
    workTimeFactor: 1,
    creditsTarget: true,
    sortOrder: 80,
  },
  {
    name: "Fortbildung",
    code: "FB",
    category: "ABSENCE",
    absenceKind: "TRAINING",
    startTime: "08:00",
    endTime: "16:24",
    breakMinutes: 0,
    color: "#0369a1",
    workTimeFactor: 1,
    creditsTarget: true,
    sortOrder: 90,
  },
  {
    name: "Abwesend",
    code: "A",
    category: "ABSENCE",
    absenceKind: "OTHER",
    startTime: "08:00",
    endTime: "16:24",
    breakMinutes: 0,
    color: "#6b7280",
    workTimeFactor: 1,
    creditsTarget: false,
    sortOrder: 100,
  },
];
