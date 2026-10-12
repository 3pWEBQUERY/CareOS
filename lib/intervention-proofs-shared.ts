// Durchführungsnachweis nach Abweichungen (Server und Oberfläche). Die Tageszeiten entsprechen den
// Medikamentenrunden; welche Massnahme wann durchgeführt wird, legt die Pflegeplanung fest.
import type { RoundKey } from "@/lib/medication-shared";

export type DayPart = RoundKey;

export const DAY_PARTS: Record<DayPart, { label: string; hours: string }> = {
  morning: { label: "Morgen", hours: "05–11 Uhr" },
  noon: { label: "Mittag", hours: "11–15 Uhr" },
  evening: { label: "Abend", hours: "15–21 Uhr" },
  night: { label: "Nacht", hours: "21–05 Uhr" },
};
export const DAY_PART_KEYS = Object.keys(DAY_PARTS) as DayPart[];

export const PROOF_OUTCOMES = {
  done: "Wie geplant",
  partial: "Teilweise",
  not_done: "Nicht durchgeführt",
} as const;
export type ProofOutcome = keyof typeof PROOF_OUTCOMES;
export type Deviation = Exclude<ProofOutcome, "done">;

export type ProofRecord = {
  id: string;
  outcome: ProofOutcome;
  reason: string;
  author: string;
  recordedAt: string;
};

export type ProofIntervention = {
  id: string;
  title: string;
  instructions: string | null;
  frequency: string | null;
  responsibleRole: string | null;
  goal: string;
  proof: ProofRecord | null;
};

export type ProofResident = {
  id: string;
  name: string;
  initials: string;
  room: string;
  careUnit: string;
  interventions: ProofIntervention[];
};

export type ProofView = {
  date: string;
  dayPart: DayPart;
  // Tag und Tageszeit jetzt (Zeitzone der Einrichtung): spätere Tageszeiten lassen sich noch nicht nachweisen.
  current: { date: string; dayPart: DayPart };
  canWrite: boolean;
  residents: ProofResident[];
};

// Reihenfolge der Tageszeiten innerhalb eines Tages (die Nacht beginnt am Abend).
export function slotOrder(date: string, dayPart: DayPart) {
  return `${date}#${DAY_PART_KEYS.indexOf(dayPart)}`;
}
