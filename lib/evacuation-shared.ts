import type { ResuscitationStatus } from "@/lib/resident-record-shared";

// Evakuierungs- und Notfallliste (Server und Oberfläche): je Wohnbereich Zimmer, Name, die dokumentierte Mobilität im
// Notfall und Hinweise (Reanimationsstatus, Isolation, eigene Hinweise wie Sauerstoff). Stand mit Datum und Uhrzeit.

export const EVACUATION_MOBILITY = {
  independent: { label: "Geht selbständig", count: "gehfähig" },
  assisted: { label: "Geht mit Hilfsmittel oder Begleitung", count: "mit Hilfe" },
  wheelchair: { label: "Rollstuhl", count: "im Rollstuhl" },
  bedridden: { label: "Bettlägerig – Transport liegend", count: "liegend" },
} as const;
export type EvacuationMobility = keyof typeof EVACUATION_MOBILITY;
export const EVACUATION_MOBILITY_KEYS = Object.keys(EVACUATION_MOBILITY) as EvacuationMobility[];

export type EvacuationPerson = {
  id: string;
  name: string;
  mobility: EvacuationMobility | null;
  note: string;
  resuscitation: ResuscitationStatus | null;
  isolation: string | null;
  // Extern verlegt (z. B. Spital): Zimmer reserviert, Person nicht im Haus.
  absent: boolean;
};

export type EvacuationRoom = { id: string | null; name: string; people: EvacuationPerson[] };

export type EvacuationUnit = {
  id: string;
  name: string;
  rooms: EvacuationRoom[];
  counts: Record<EvacuationMobility | "unknown" | "absent", number>;
};

export type EvacuationList = { generatedAt: string; organization: string; units: EvacuationUnit[] };
