// Care documentation definitions shared by the API and the client workspace.

export const DOC_CATEGORIES = [
  "Pflege",
  "Beobachtung",
  "Mobilität",
  "Schmerz",
  "Ernährung",
  "Medikation",
  "Vitalwerte",
  "Wunde",
  "Sturz",
  "Verhalten / Psyche",
  "Arztvisite",
  "Angehörigengespräch",
  "Teamübergabe",
  "Sonstiges",
] as const;

export const IMPORTANCE = {
  standard: { label: "Standard", tone: "info" },
  important: { label: "Wichtig für Übergabe", tone: "attention" },
  visit: { label: "Für Visite", tone: "info" },
  observation: { label: "Beobachten", tone: "attention" },
  critical: { label: "Kritisch", tone: "critical" },
} as const;
export type Importance = keyof typeof IMPORTANCE;

// Text building blocks for frequent entries; the nurse completes them.
export const TEMPLATES: Array<{ label: string; category: string; text: string }> = [
  {
    label: "Morgenpflege",
    category: "Pflege",
    text: "Morgenpflege am Lavabo mit Unterstützung beim Rücken und den Füssen. Haut intakt, ",
  },
  {
    label: "Mobilisation",
    category: "Mobilität",
    text: "Mit Rollator und Begleitung im Korridor mobilisiert, Gehstrecke ca.  m. Gangbild ",
  },
  {
    label: "Trinkmenge",
    category: "Ernährung",
    text: "Getränke aktiv angeboten. Trinkt selbständig/mit Unterstützung, ",
  },
  {
    label: "Schmerz",
    category: "Schmerz",
    text: "Schmerzen gemäss NRS: /10, Lokalisation: . Massnahme: . Wirkung nach 60 Min.: ",
  },
  { label: "Nachtruhe", category: "Beobachtung", text: "Nacht ruhig/unruhig verbracht. Kontrollgänge um . Schlaf " },
  {
    label: "Sturz",
    category: "Sturz",
    text: "Am Boden aufgefunden um . Vitalzeichen: . Verletzungen: . Arzt informiert: ja/nein. ",
  },
];

export type DocEntry = {
  id: string;
  residentId: string;
  residentName: string;
  room: string;
  category: string;
  body: string;
  importance: Importance;
  occurredAt: string;
  createdAt: string;
  author: string | null;
  amendedFromId: string | null;
  amendReason: string | null;
  // Set on originals that were corrected by a later entry.
  amendedBy: { id: string; createdAt: string; author: string | null } | null;
};

export type DocStats = {
  todayCount: number;
  myTodayCount: number;
  perDay: Array<{ date: string; count: number }>;
  withoutEntry: Array<{ id: string; name: string; room: string; lastAt: string | null }>;
};
