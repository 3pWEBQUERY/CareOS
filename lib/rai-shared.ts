// Kompass-Arbeitsplatz (Arbeitskorb, Fälligkeiten, Berichte): Typen und Bezeichnungen für API und Seiten.

export type RaiState = "new" | "due" | "overdue" | "in_progress" | "current";
export const RAI_STATE: Record<RaiState, { label: string; tone: "stable" | "attention" | "critical" | "info" }> = {
  new: { label: "Neuaufnahme", tone: "info" },
  due: { label: "Fällig", tone: "attention" },
  overdue: { label: "Fällig", tone: "critical" },
  in_progress: { label: "In Bearbeitung", tone: "attention" },
  current: { label: "Aktuell", tone: "stable" },
};

export type RaiPerson = {
  id: string;
  name: string;
  initials: string;
  openAssessments: number;
  online: boolean;
};

export type RaiResidentRow = {
  id: string;
  name: string;
  initials: string;
  room: string;
  unit: string;
  careUnitId: string | null;
  state: RaiState;
  reason: string;
  dueOn: string | null;
  progress: number;
  instrument: string | null;
  assessorId: string | null;
  assessor: string | null;
  draftId: string | null;
  lastCompletedOn: string | null;
  // Bereiche mit Handlungsbedarf in der letzten abgeschlossenen Abklärung (null: noch keine mit dem Kompass).
  needs: number | null;
};

export type RaiWorkplace = {
  residents: RaiResidentRow[];
  people: RaiPerson[];
  summary: { records: number; due: number; currentShare: number; responsible: number; drafts: number };
};
