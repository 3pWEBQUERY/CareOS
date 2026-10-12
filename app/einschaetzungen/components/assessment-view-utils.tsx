"use client";

import { type Instrument } from "@/lib/assessment-instruments";
import type { AssessmentResult, DueItem } from "@/lib/assessments";

export type Overview = {
  instruments: Instrument[];
  residents: Array<{ id: string; name: string; initials: string; room: string; careUnit: string }>;
  latest: AssessmentResult[];
  canWrite: boolean;
};

export const ALL = "Alle Instrumente";

export const RISK_FILTERS = ["Alle", "Hohes Risiko", "Mittleres Risiko", "Kein erhöhtes Risiko"] as const;

export const toneFor = (filter: (typeof RISK_FILTERS)[number]) =>
  filter === "Hohes Risiko" ? "critical" : filter === "Mittleres Risiko" ? "attention" : "stable";

export const kindLabel: Record<DueItem["kind"], string> = {
  overdue: "Überfällig",
  open: "Offen",
  due: "Fällig",
  missing: "Nie erfasst",
};

export const kindTone: Record<DueItem["kind"], string> = {
  overdue: "critical",
  open: "attention",
  due: "attention",
  missing: "info",
};

export const DUE_FILTERS = ["Alle", "Überfällig", "Fällig", "Nie erfasst", "Offen"] as const;
