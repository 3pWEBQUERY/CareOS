// Isolation und Ausbruch: Arten der Isolation, Überprüfung und Übersicht (Server und Oberfläche). Organisatorisch,
// ohne Diagnose: Anlass und Anordnung stammen von Ärztin/Arzt bzw. Hygienefachperson.

export const ISOLATION_KINDS = {
  contact: "Kontaktisolation",
  droplet: "Tröpfchenisolation",
  airborne: "Aerogene Isolation",
  protective: "Schutzisolation (Umkehrisolation)",
  other: "Andere Hygienemassnahme",
} as const;
export type IsolationKind = keyof typeof ISOLATION_KINDS;
export const ISOLATION_KIND_KEYS = Object.keys(ISOLATION_KINDS) as IsolationKind[];

export const ISOLATION_REVIEW_OUTCOMES = { continue: "Weiterführen", end: "Aufheben" } as const;
export type IsolationReviewOutcome = keyof typeof ISOLATION_REVIEW_OUTCOMES;

export type IsolationReview = {
  id: string;
  reviewedAt: string;
  reviewedBy: string;
  outcome: IsolationReviewOutcome;
  note: string;
  nextReviewOn: string | null;
};

export type IsolationMeasure = {
  id: string;
  residentId: string;
  residentName: string;
  room: string;
  careUnitId: string | null;
  careUnit: string;
  outbreakId: string | null;
  kind: IsolationKind;
  reason: string;
  precautions: string;
  orderedBy: string;
  startsAt: string;
  reviewOn: string;
  reviewDue: boolean;
  endedAt: string | null;
  endNote: string;
  createdBy: string;
  reviews: IsolationReview[];
};

export type Outbreak = {
  id: string;
  careUnitId: string | null;
  careUnit: string | null;
  title: string;
  measures: string;
  declaredAt: string;
  declaredBy: string;
  authorityReportedOn: string | null;
  authorityNote: string;
  endedAt: string | null;
  endNote: string;
  // Laufende Isolationen, die diesem Ausbruch zugeordnet sind.
  activeIsolations: number;
};

export type HygieneOverview = {
  careUnitId: string | null;
  today: string;
  canWrite: boolean;
  canManage: boolean;
  active: IsolationMeasure[];
  // Aufgehobene Isolationen und beendete Ausbrüche der letzten 90 Tage.
  ended: IsolationMeasure[];
  outbreaks: Outbreak[];
  endedOutbreaks: Outbreak[];
};

export const isolationLabel = (kind: IsolationKind) => ISOLATION_KINDS[kind] ?? ISOLATION_KINDS.other;
