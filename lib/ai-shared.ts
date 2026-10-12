// CareOS KI: types and labels shared by API and pages.

export const AI_TASKS = {
  handover: { label: "Übergabe zusammenfassen", icon: "handover" },
  risks: { label: "Risiken für die Visite prüfen", icon: "alert" },
  documentation: { label: "Dokumentation vorbereiten", icon: "note" },
  carePlan: { label: "Pflegeplanung vorschlagen", icon: "plan" },
  question: { label: "Freie Frage", icon: "ai" },
  kompassSummary: { label: "Gesamtbild Kompass", icon: "compass" },
  rephrase: { label: "Text umformulieren", icon: "note" },
} as const;
export type AiTask = keyof typeof AI_TASKS;

export type AiDraftStatus = "draft" | "reviewed" | "accepted" | "discarded";

export type AiDraft = {
  id: string;
  task: AiTask;
  prompt: string;
  content: string;
  status: AiDraftStatus;
  residentId: string | null;
  residentName: string | null;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  // Where an accepted draft was saved (documentation entry or handover note).
  savedAs: "documentation" | "handover" | null;
};

export type AiOverview = {
  configured: boolean;
  context: {
    careUnit: string | null;
    residents: number;
    openTasks: number;
    criticalVitals: number;
    unreadHandovers: number;
  };
  pending: number;
};
