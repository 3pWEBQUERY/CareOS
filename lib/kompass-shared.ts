// CareOS Kompass: Typen für API und Oberfläche.
import type { ContextKey, KompassData } from "@/lib/kompass-instrument";
import type { RaiPerson } from "@/lib/rai-shared";

export type KompassStatus = "new" | "in_progress" | "current" | "overdue" | "archived";

export type KompassAssessment = {
  id: string;
  instrument: string;
  status: KompassStatus;
  dueOn: string | null;
  progress: number;
  assessorId: string | null;
  assessor: string | null;
  completedAt: string | null;
  completedBy: string | null;
  updatedAt: string;
  // Abklärung mit dem Kompass; frühere vereinfachte Erfassungen nur mit Notiz und Stufen je Bereich.
  kompass: KompassData | null;
  legacy: { assessedOn: string; notes: string; scores: Record<string, number> } | null;
};

// Fakten aus anderen Bereichen der Akte, beim passenden Kompass-Bereich gezeigt (ohne Bewertung).
export type KompassFact = { label: string; detail: string; href: string };
export type KompassContext = Record<ContextKey, KompassFact[]>;

export type KompassDetail = {
  resident: { id: string; name: string; room: string; unit: string; admittedOn: string | null };
  // Laufende Abklärung (Entwurf) und geplante, noch nicht begonnene.
  draft: KompassAssessment | null;
  planned: { id: string; dueOn: string | null } | null;
  history: KompassAssessment[];
  // Antworten der letzten abgeschlossenen Abklärung mit dem Kompass (zum Vergleich).
  previous: KompassAssessment | null;
  people: RaiPerson[];
  context: KompassContext;
  settings: { admissionDays: number | null; intervalMonths: number | null };
  today: string;
  // Ob die Fachperson einen Entwurf für das Gesamtbild mit CareOS KI anfordern kann.
  aiDraft: boolean;
};

export type KompassReport = {
  resident: { id: string; name: string; birthDate: string | null; room: string; unit: string };
  assessment: KompassAssessment;
  // Vorherige abgeschlossene Abklärung mit dem Kompass (für den Vergleich je Frage).
  previous: KompassAssessment | null;
  // Aus dem Handlungsbedarf übernommene Ziele der Pflegeplanung.
  goals: Record<string, { statement: string; status: string; targetDate: string | null }>;
  canAdopt: boolean;
};

export type KompassStatusSummary = {
  lastOn: string | null;
  needs: string[];
  dueOn: string | null;
  // Fortschritt in Prozent, wenn eine Abklärung begonnen ist.
  inProgress: number | null;
  canOpen: boolean;
};

// Auswertung je Wohnbereich: nur gezählt, ohne Wertung. Grundlage ist die letzte abgeschlossene Abklärung mit dem
// Kompass jeder Person, die derzeit im Haus bzw. im Wohnbereich wohnt.
export type KompassStatistics = {
  careUnit: { id: string; name: string } | null;
  people: number;
  assessed: number;
  domains: Array<{
    id: string;
    title: string;
    // Personen mit mindestens einer Antwort über der ersten Stufe der Skala in diesem Bereich.
    withSupport: number;
    // Personen, bei denen die Fachperson Handlungsbedarf festgehalten hat.
    withNeed: number;
    items: Array<{
      key: string;
      label: string;
      // Anzahl Personen je Antwort in der Reihenfolge der Skala; „Trifft nicht zu“ separat.
      counts: Array<{ value: string; label: string; count: number }>;
      notApplicable: number;
      answered: number;
    }>;
  }>;
};
