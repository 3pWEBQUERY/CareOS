// Lagerungs- und Bewegungsprotokoll (Server und Oberfläche). Positionen und Hautbefund sind Beobachtungen; das
// Intervall stammt aus der Pflegeplanung, CareOS schlägt keines vor.

export const POSITIONS = {
  back: "Rückenlage",
  right30: "30°-Seitenlage rechts",
  left30: "30°-Seitenlage links",
  right90: "Seitenlage rechts",
  left90: "Seitenlage links",
  semi_sitting: "Oberkörper hoch",
  sitting: "Sitzen (Stuhl, Rollstuhl)",
  mobilized: "Mobilisiert (gestanden, gegangen)",
  micro: "Mikrolagerung",
  other: "Andere (siehe Bemerkung)",
} as const;
export type Position = keyof typeof POSITIONS;

// Hautbefund an den belasteten Stellen beim Wechsel (Fingertest).
export const SKIN_FINDINGS = {
  normal: "Haut unauffällig",
  blanching: "Rötung, wegdrückbar",
  non_blanching: "Rötung, nicht wegdrückbar",
  broken: "Haut verletzt oder offen",
  not_assessed: "nicht beurteilt",
} as const;
export type SkinFinding = keyof typeof SKIN_FINDINGS;

export type RepositioningPlan = {
  id: string;
  intervalMinutes: number;
  interventionId: string | null;
  intervention: string | null;
  note: string;
  createdAt: string;
  createdBy: string;
};

export type RepositioningEntry = {
  id: string;
  performedAt: string;
  position: Position;
  skin: SkinFinding;
  note: string;
  author: string;
  cancelled: { at: string; by: string; reason: string } | null;
};

export type RepositioningView = {
  residentId: string;
  canWrite: boolean;
  plan: RepositioningPlan | null;
  // Nächster Wechsel laut Plan: letzter Wechsel (sonst Beginn des Plans) plus Intervall.
  nextDueAt: string | null;
  overdue: boolean;
  lastAt: string | null;
  // Massnahmen der laufenden Pflegeplanung, auf die sich der Plan stützen kann.
  interventions: Array<{ id: string; title: string; frequency: string }>;
  entries: RepositioningEntry[];
  // Zeitraum der Einträge (Stunden zurück).
  hours: number;
};

export function formatInterval(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} Min.`;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}
