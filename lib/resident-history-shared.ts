// House-wide resident history and archive, shared by the API and the client page.

export const HISTORY_STATUSES = ["Alle", "Aktiv", "Geplant", "Verlegt", "Ausgetreten", "Verstorben"] as const;
export type HistoryFilter = (typeof HISTORY_STATUSES)[number];
export type HistoryStatus = Exclude<HistoryFilter, "Alle">;
export type HistoryTone = "critical" | "attention" | "info" | "stable" | "archived";

export const LIFECYCLE_LABELS: Record<string, HistoryStatus> = {
  active: "Aktiv",
  planned: "Geplant",
  transferred: "Verlegt",
  discharged: "Ausgetreten",
  archived: "Ausgetreten",
  deceased: "Verstorben",
};

// Ending a stay: discharge, external transfer (room stays reserved) or death.
export const EXIT_KINDS = {
  discharged: { label: "Austritt", dateLabel: "Austrittsdatum" },
  transferred: { label: "Verlegung (extern)", dateLabel: "Verlegungsdatum" },
  deceased: { label: "Todesfall", dateLabel: "Sterbedatum" },
} as const;
export type ExitKind = keyof typeof EXIT_KINDS;

export type HistoryResident = {
  id: string;
  initials: string;
  name: string;
  room: string;
  careUnit: string;
  status: HistoryStatus;
  tone: HistoryTone;
  admittedOn: string | null;
  endedOn: string | null;
  lastEntry: { title: string; body: string; occurredAt: string; author: string | null } | null;
  entryCount: number;
};

export type HistoryStay = {
  id: string;
  careUnit: string;
  room: string;
  startedAt: string;
  endedAt: string | null;
};

export type HistoryEntry = {
  id: string;
  title: string;
  body: string;
  category: string;
  importance: string;
  occurredAt: string;
  author: string | null;
};

export type HistoryDetail = { stays: HistoryStay[]; entries: HistoryEntry[] };

export type HistoryOverview = {
  residents: HistoryResident[];
  units: string[];
  canWrite: boolean;
};
