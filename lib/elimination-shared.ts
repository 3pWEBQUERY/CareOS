// Ausscheidungs- und Kontinenzprotokoll (Server und Oberfläche). Beobachtungen ohne Bewertung; eine Erinnerung gibt es
// nur mit der Tageszahl, die die Einrichtung festlegt (Einstellung „Hinweis Stuhlgang“).

export const ELIMINATION_KINDS = {
  stool: "Stuhlgang",
  urine: "Wasserlassen",
  incontinence_urine: "Urininkontinenz",
  incontinence_stool: "Stuhlinkontinenz",
  material: "Inkontinenzmaterial gewechselt",
} as const;
export type EliminationKind = keyof typeof ELIMINATION_KINDS;

// Bristol-Stuhlformen-Skala (Lewis & Heaton 1997): deutsche Übersetzung der veröffentlichten Beschreibungen; CareOS
// bewertet die Form nicht.
export const BRISTOL_TYPES: Record<number, string> = {
  1: "Typ 1 · einzelne, harte Klumpen (wie Nüsse)",
  2: "Typ 2 · wurstförmig, aber klumpig",
  3: "Typ 3 · wurstförmig mit Rissen an der Oberfläche",
  4: "Typ 4 · wurst- oder schlangenförmig, glatt und weich",
  5: "Typ 5 · weiche Klümpchen mit klaren Rändern",
  6: "Typ 6 · flockige Stücke mit ausgefransten Rändern, breiig",
  7: "Typ 7 · wässrig, ohne feste Bestandteile",
};

export const ELIMINATION_AMOUNTS = { small: "wenig", medium: "mittel", large: "viel" } as const;
export type EliminationAmount = keyof typeof ELIMINATION_AMOUNTS;

export type EliminationEntry = {
  id: string;
  occurredAt: string;
  kind: EliminationKind;
  bristol: number | null;
  volume: EliminationAmount | null;
  material: string;
  note: string;
  author: string;
  cancelled: { at: string; by: string; reason: string } | null;
};

export type EliminationView = {
  residentId: string;
  canWrite: boolean;
  // Letzter nicht stornierter Stuhlgang (auch bei Stuhlinkontinenz) und ganze Tage seither.
  lastStoolAt: string | null;
  daysSinceStool: number | null;
  // Tageszahl der Einrichtung für den Hinweis; null = nicht festgelegt.
  reminderDays: number | null;
  // Letzter Stuhlgang liegt mindestens so viele Tage zurück (nur mit festgelegter Tageszahl).
  overdue: boolean;
  entries: EliminationEntry[];
  days: number;
};
