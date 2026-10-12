// Hilfsmittel, persönliche Gegenstände, Kleidung bzw. Wäsche und Einrichtung je Person (Server und Oberfläche); daraus
// entsteht auch die Inventarliste beim Eintritt.

export const BELONGING_KINDS = {
  aid: "Hilfsmittel",
  personal: "Persönlicher Gegenstand",
  clothing: "Kleidung / Wäsche",
  furniture: "Einrichtung",
} as const;
export type BelongingKind = keyof typeof BELONGING_KINDS;

// Häufige Gegenstände zur Schnellauswahl (nur Bezeichnungen, frei ergänzbar).
export const BELONGING_SUGGESTIONS: Record<BelongingKind, string[]> = {
  aid: ["Brille", "Hörgerät", "Zahnprothese", "Rollator", "Rollstuhl", "Gehstock"],
  personal: ["Ehering", "Armbanduhr", "Mobiltelefon", "Portemonnaie"],
  clothing: ["Hose", "Bluse / Hemd", "Pullover", "Unterwäsche", "Socken", "Nachthemd / Pyjama", "Jacke", "Schuhe"],
  furniture: ["Sessel", "Kommode", "Fernseher", "Bild", "Lampe", "Teppich"],
};

// Wo der Gegenstand aufbewahrt wird (Auswahl im Dialog; ein früher frei erfasster Standort bleibt erhalten).
export const BELONGING_LOCATIONS = [
  "Trägt die Person",
  "Am Bett",
  "Nachttisch",
  "Kleiderschrank",
  "Kommode",
  "Bad",
  "Im Zimmer",
  "Am Rollstuhl / Rollator",
  "Stationszimmer",
  "Wäscherei",
  "Lager / Keller",
  "Bei Angehörigen",
];

// Gegenstände für den Überleitungsbogen (Kleidung und Einrichtung bleiben im Haus).
export const TRANSFER_KINDS: BelongingKind[] = ["aid", "personal"];

export type Belonging = {
  id: string;
  kind: BelongingKind;
  name: string;
  quantity: number;
  marking: string;
  location: string;
  note: string;
  updatedAt: string;
  updatedBy: string | null;
  removed: { at: string; by: string | null; reason: string } | null;
};

export type BelongingList = { residentId: string; canWrite: boolean; belongings: Belonging[] };

// Inventarliste zum Drucken: vorhandene Gegenstände mit Angaben zur Person und zum Eintritt.
export type BelongingInventory = {
  organization: string;
  residentName: string;
  room: string;
  careUnit: string;
  admittedOn: string | null;
  generatedAt: string;
  belongings: Belonging[];
};
