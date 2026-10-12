// Medizinische Qualitätsindikatoren (MQI) der Schweizer Pflegeheime, aus den Daten von CareOS berechnet.
// Definitionen nach BAG bzw. ARTISET/CURAVIVA (Faktenblätter 2024/2025). Die offizielle Erhebung erfolgt über das
// Bedarfsabklärungsinstrument (interRAI LTCF, BESA, Plaisir); diese Auswertung dient der internen Steuerung.

export type IndicatorKey =
  "malnutrition" | "trunk_restraint" | "bed_rails" | "polymedication" | "pain_self" | "pressure_ulcer";

export type IndicatorBasis = "exact" | "approximation";

export type IndicatorResult = {
  key: IndicatorKey;
  title: string;
  // Offizielle Definition (Kurzfassung) und was CareOS dafür zählt.
  definition: string;
  method: string;
  basis: IndicatorBasis;
  numerator: number;
  denominator: number;
  // Personen ohne ausreichende Daten (z. B. kein Vergleichsgewicht); nicht im Nenner.
  notAssessable: number;
  percent: number | null;
  residents: Array<{ id: string; name: string; room: string; detail: string }>;
};

export type QualityIndicators = {
  measuredAt: string;
  careUnitId: string | null;
  population: number;
  indicators: IndicatorResult[];
};

export const BASIS_LABELS: Record<IndicatorBasis, string> = {
  exact: "Nach Definition",
  approximation: "Annäherung",
};
