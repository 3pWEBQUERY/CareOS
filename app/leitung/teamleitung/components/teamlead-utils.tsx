"use client";

export type View = "employees" | "tasks";

export type Employee = {
  id: string;
  display_name: string;
  username?: string;
  role: string;
  active: boolean;
  archived_at?: string | null;
  care_unit_name?: string;
  primary_care_unit_id?: string | null;
  job_title?: string;
  phone?: string;
};

export type TeamleadRow = Employee & {
  name?: string;
  title?: string;
  assignee?: string;
  description?: string;
  status?: string;
  priority?: string;
  due_at?: string | null;
  care_unit_name?: string;
};

export type Unit = { id: string; name: string };

export const config = {
  employees: {
    title: "Mitarbeiter",
    eyebrow: "TEAMLEITUNG · PERSONAL",
    subtitle: "Dein Team im Blick – Zuständigkeiten, Rollen und Verfügbarkeit an einem Ort.",
    action: "Mitarbeiter erstellen",
  },
  tasks: {
    title: "Aufgaben",
    eyebrow: "TEAMLEITUNG · ARBEITSSTEUERUNG",
    subtitle: "Verantwortlichkeiten klar verteilen und den Fortschritt im Team nachhalten.",
    action: "Aufgabe erstellen",
  },
} as const;

export const endpointFor = (view: View) => `/api/teamlead/${view === "employees" ? "employees" : "tasks"}`;

export const initials = (value: string) =>
  value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const labelRole = (role?: string) =>
  ({
    admin: "Administration",
    leitung: "Leitung",
    pflege: "Pflege",
    arzt: "Ärztlicher Dienst",
    "mitarbeitende:r": "Mitarbeitende:r",
  })[role ?? ""] ?? "Mitarbeitende:r";

export const priorityLabel = (priority?: string) =>
  ({ low: "Niedrig", normal: "Normal", high: "Hoch", critical: "Kritisch" })[priority ?? ""] ?? "Normal";

export const formatDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(
        new Date(value),
      )
    : "Nicht terminiert";
