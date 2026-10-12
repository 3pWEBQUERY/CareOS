import type { CountryCode } from "@/lib/country";

// Freiheitsbeschränkende Massnahmen (FBM): Arten, Einwilligung und Rechtsgrundlage je Land (Server und Oberfläche).

export const RESTRAINT_KINDS = {
  bed_rails: "Bettseitenteile",
  belt: "Gurt / Fixierung",
  sensor_mat: "Sensor- oder Klingelmatte",
  locked_door: "Geschlossene Tür / Bereich",
  therapy_table: "Therapietisch / Stuhlbrett",
  medication: "Medikamentös (ärztlich verordnet)",
  other: "Andere Massnahme",
} as const;
export type RestraintKind = keyof typeof RESTRAINT_KINDS;
export const RESTRAINT_KIND_KEYS = Object.keys(RESTRAINT_KINDS) as RestraintKind[];

export const RESTRAINT_CONSENT = {
  consents: "Stimmt zu",
  refuses: "Lehnt ab",
  incapable: "Nicht urteilsfähig",
} as const;
export type RestraintConsent = keyof typeof RESTRAINT_CONSENT;

export const RESTRAINT_REVIEW_OUTCOMES = { continue: "Weiterführen", end: "Beenden" } as const;
export type RestraintReviewOutcome = keyof typeof RESTRAINT_REVIEW_OUTCOMES;

// Grundlage und Bezeichnung des Feldes für Genehmigung bzw. Meldung je Land der Einrichtung.
export const RESTRAINT_LAW: Record<CountryCode, { basis: string; approval: string; approvalHint: string }> = {
  CH: {
    basis: "ZGB Art. 383–385 (Einschränkung der Bewegungsfreiheit)",
    approval: "Erwachsenenschutzbehörde",
    approvalHint: "Falls beigezogen: Datum oder Geschäftsnummer",
  },
  DE: {
    basis: "§ 1831 Abs. 4 BGB (freiheitsentziehende Maßnahmen)",
    approval: "Genehmigung Betreuungsgericht",
    approvalHint: "Datum und Aktenzeichen des Beschlusses",
  },
  AT: {
    basis: "Heimaufenthaltsgesetz (HeimAufG)",
    approval: "Meldung Bewohnervertretung",
    approvalHint: "Datum der Verständigung",
  },
};

export type RestraintReview = {
  id: string;
  reviewedAt: string;
  reviewedBy: string;
  outcome: RestraintReviewOutcome;
  note: string;
  nextReviewOn: string | null;
};

export type RestraintMeasure = {
  id: string;
  residentId: string;
  kind: RestraintKind;
  description: string;
  reason: string;
  alternatives: string;
  schedule: string;
  orderedBy: string;
  residentConsent: RestraintConsent;
  residentInformed: boolean;
  representativeName: string;
  representativeInformedOn: string | null;
  approvalReference: string;
  startsAt: string;
  plannedUntil: string | null;
  reviewOn: string;
  endedAt: string | null;
  endReason: string;
  createdBy: string;
  reviewDue: boolean;
  reviews: RestraintReview[];
};

export const restraintLabel = (measure: Pick<RestraintMeasure, "kind" | "description">) =>
  measure.kind === "other" ? measure.description : RESTRAINT_KINDS[measure.kind];
