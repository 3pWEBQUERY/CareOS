import type { CountryCode } from "@/lib/country";

// Vorsorge und Vertretung (Server und Oberfläche): Bezeichnungen je Land der Einrichtung. CareOS hält nur fest,
// was vorliegt; ob ein Dokument wirksam ist, beurteilt die Einrichtung.

export type AdvanceAnswer = "yes" | "no";

export const REPRESENTATIVE_ROLE_KEYS = ["mandate", "official", "spouse", "relative", "other"] as const;
export type RepresentativeRole = (typeof REPRESENTATIVE_ROLE_KEYS)[number];

type CountryLabels = {
  careMandate: string;
  careMandateEffective: string;
  roles: Record<RepresentativeRole, string>;
};

export const ADVANCE_CARE_LABELS: Record<CountryCode, CountryLabels> = {
  CH: {
    careMandate: "Vorsorgeauftrag",
    careMandateEffective: "Von der Erwachsenenschutzbehörde validiert am",
    roles: {
      mandate: "Vorsorgebeauftragte Person",
      official: "Beistand / Beiständin",
      spouse: "Ehegatte / eingetragene Partnerschaft",
      relative: "Angehörige Person",
      other: "Andere vertretungsberechtigte Person",
    },
  },
  DE: {
    careMandate: "Vorsorgevollmacht",
    careMandateEffective: "Wirksam seit",
    roles: {
      mandate: "Bevollmächtigte Person (Vorsorgevollmacht)",
      official: "Rechtliche Betreuung",
      spouse: "Ehegatte / Lebenspartnerschaft",
      relative: "Angehörige Person",
      other: "Andere vertretungsberechtigte Person",
    },
  },
  AT: {
    careMandate: "Vorsorgevollmacht",
    careMandateEffective: "Im Vertretungsverzeichnis eingetragen am",
    roles: {
      mandate: "Vorsorgebevollmächtigte Person",
      official: "Erwachsenenvertretung",
      spouse: "Ehegatte / eingetragene Partnerschaft",
      relative: "Angehörige Person",
      other: "Andere vertretungsberechtigte Person",
    },
  },
};

export const ADVANCE_ANSWERS: Record<AdvanceAnswer, string> = { yes: "Liegt vor", no: "Liegt nicht vor" };

export const advanceShort = (value: AdvanceAnswer | null) =>
  value === "yes" ? "PV: Ja" : value === "no" ? "PV: Nein" : "PV: –";

export const isRepresentativeRole = (value: unknown): value is RepresentativeRole =>
  typeof value === "string" && (REPRESENTATIVE_ROLE_KEYS as readonly string[]).includes(value);

export type Representative = { name: string; role: RepresentativeRole; phone: string | null };
