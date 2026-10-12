// Einwilligungen und Freigaben je Person (Server und Oberfläche). Die Themen legt die Einrichtung fest.

export const CONSENT_DECISIONS = { granted: "Zugestimmt", refused: "Abgelehnt" } as const;
export type ConsentDecision = keyof typeof CONSENT_DECISIONS;
// Stand je Thema: jüngster Entscheid; widerrufen, wenn dieser widerrufen wurde.
export type ConsentStatus = ConsentDecision | "revoked" | "missing";
export const CONSENT_STATUS: Record<ConsentStatus, string> = {
  granted: "Zugestimmt",
  refused: "Abgelehnt",
  revoked: "Widerrufen",
  missing: "Nicht erfasst",
};

export type ConsentEntry = {
  id: string;
  topic: string;
  decision: ConsentDecision;
  decidedBy: string;
  decidedOn: string;
  note: string;
  recordedBy: string | null;
  revoked: { on: string; by: string | null; note: string } | null;
};

export type ConsentTopicState = { topic: string; status: ConsentStatus; current: ConsentEntry | null };

export type ConsentList = {
  residentId: string;
  canWrite: boolean;
  // Themen der Einrichtung mit Stand; dazu Themen mit Einträgen, die die Einrichtung inzwischen entfernt hat.
  topics: ConsentTopicState[];
  history: ConsentEntry[];
};

export type ConsentOverview = {
  topic: string;
  topics: string[];
  units: Array<{
    id: string;
    name: string;
    residents: Array<{ id: string; name: string; room: string; status: ConsentStatus; since: string | null }>;
  }>;
};

export const CONSENT_TOPICS_MAX = 30;
