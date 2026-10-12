// Überleitungsbogen: Antwort der API und Grundlage der Druckansicht.
import type { Diagnosis } from "./diagnoses-shared";
import type { BelongingKind } from "./belongings-shared";
import type { MasterData } from "./resident-record-shared";
import type { Representative } from "./advance-care-shared";
import type { CountryCode } from "./country";

export type TransferSheet = {
  createdAt: string;
  createdBy: string;
  facility: {
    organization: string;
    site: string | null;
    address: string;
    phone: string | null;
    email: string | null;
    unit: string | null;
    floor: string | null;
    room: string | null;
  };
  master: MasterData;
  // Vertretungsberechtigte Person (Kontaktperson mit Rolle) und Land für deren Bezeichnung.
  representative: Representative | null;
  country: CountryCode;
  careLevel: string | null;
  primaryNurse: string | null;
  allergies: string[];
  // Aktuelle Diagnosen (Hauptdiagnosen zuerst), wie in der Akte erfasst.
  diagnoses: Array<Pick<Diagnosis, "label" | "icdCode" | "kind" | "sinceOn">>;
  // Letzte dokumentierte Impfung je „Impfung gegen“.
  vaccinations: Array<{ target: string; givenOn: string }>;
  // Vorhandene Hilfsmittel und Gegenstände, zum Abhaken „mitgegeben“ auf dem Papier.
  belongings: Array<{ name: string; kind: BelongingKind; marking: string }>;
  contacts: Array<{
    name: string;
    relationship: string | null;
    phone: string | null;
    email: string | null;
    primary: boolean;
    emergency: boolean;
  }>;
  flags: Array<{
    label: string;
    category: string;
    severity: "critical" | "attention" | "info";
    details: string | null;
  }>;
  // Laufende freiheitsbeschränkende Massnahmen (Art, Zeitraum, Beginn).
  isolations: Array<{ label: string; reason: string; precautions: string | null; since: string }>;
  restraints: Array<{ label: string; schedule: string | null; since: string }>;
  nutrition: {
    diet: string | null;
    texture: string | null;
    fluidTargetMl: number | null;
    instructions: string | null;
  } | null;
  carePlan: { focus: string | null; goals: Array<{ category: string; statement: string }> } | null;
  medication: Array<{
    name: string;
    // Betäubungsmittel
    controlled: boolean;
    form: string;
    route: string;
    amount: string;
    times: string[];
    weekdays: number[];
    prn: boolean;
    prnInstructions: string | null;
    maxDosesPer24h: number | null;
    indication: string | null;
    paused: boolean;
    lastAdministeredAt: string | null;
  }>;
  wounds: Array<{ title: string; location: string; status: string; critical: boolean }>;
  bodyFindings: Array<{ kind: string; label: string; location: string; status: string }>;
  vitals: Array<{
    metric: string;
    value: number;
    secondaryValue: number | null;
    unit: string;
    status: string;
    measuredAt: string;
  }>;
  recentNotes: Array<{
    category: string;
    title: string | null;
    body: string;
    occurredAt: string;
    important: boolean;
    author: string | null;
  }>;
};

// Alter in ganzen Jahren am Stichtag.
export function ageOn(dateOfBirth: string | null, reference: Date) {
  if (!dateOfBirth) return null;
  const [year, month, day] = dateOfBirth.slice(0, 10).split("-").map(Number);
  let age = reference.getFullYear() - year;
  if (reference.getMonth() + 1 < month || (reference.getMonth() + 1 === month && reference.getDate() < day)) age -= 1;
  return age;
}

const WEEKDAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Einnahmeschema: Uhrzeiten und – falls nicht täglich – Wochentage (1 = Montag).
export function scheduleLabel(times: string[], weekdays: number[]) {
  const days =
    weekdays.length && weekdays.length < 7
      ? ` (${[...weekdays]
          .sort((a, b) => a - b)
          .map((day) => WEEKDAY_NAMES[day - 1] ?? day)
          .join(", ")})`
      : "";
  return times.length ? `${[...times].sort().join(" · ")}${days}` : days.trim();
}
