// Visite vorbereiten: offene Einträge „Für Visite“ je Ärztin bzw. Arzt (Hausarzt laut Stammdaten).

export type VisitItem = {
  id: string;
  category: string;
  body: string;
  occurredAt: string;
  author: string;
};

export type VisitResident = {
  id: string;
  name: string;
  room: string;
  careUnit: string;
  // Aktuelle Diagnosen (Hauptdiagnosen zuerst) als Kurzform, z. B. „Morbus Parkinson (G20)“.
  diagnoses: string[];
  items: VisitItem[];
};

export type VisitGroup = {
  // Hausärztin bzw. Hausarzt aus den Stammdaten; null = nicht erfasst.
  physician: { name: string; practice: string | null; phone: string | null } | null;
  residents: VisitResident[];
};

export type VisitResolved = {
  entryId: string;
  residentId: string;
  residentName: string;
  question: string;
  response: string;
  physician: string;
  resolvedAt: string;
  resolvedBy: string;
};

export type VisitOverview = {
  careUnitId: string | null;
  canWrite: boolean;
  open: number;
  groups: VisitGroup[];
  // Rückmeldungen der letzten 14 Tage.
  resolved: VisitResolved[];
};
