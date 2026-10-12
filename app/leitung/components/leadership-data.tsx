"use client";

export const meta: Record<
  LeadershipView,
  {
    module: string;
    child: string;
    eyebrow: string;
    title: string;
    description: string;
    action: string;
    kpis: Array<[string, string, string, Tone?]>;
  }
> = {
  organization: {
    module: "admin",
    child: "Organisation",
    eyebrow: "Administration",
    title: "Organisation",
    description: "Standorte, Wohnbereiche und Verantwortlichkeiten zentral steuern.",
    action: "Standort hinzufügen",
    kpis: [
      ["—", "Wohnbereiche", "Daten werden geladen", "info"],
      ["—", "Mitarbeitende", "Daten werden geladen", "info"],
      ["—", "Standorte", "Daten werden geladen", "info"],
      ["—", "Ohne Leitung", "Daten werden geladen", "info"],
    ],
  },
  users: {
    module: "admin",
    child: "Mitarbeiter",
    eyebrow: "Administration",
    title: "Mitarbeiter",
    description: "Mitarbeiterprofile, Rollen und Zugriffe sicher verwalten.",
    action: "Mitarbeiter erstellen",
    kpis: [
      ["—", "Mitarbeiter aktiv", "Daten werden geladen", "info"],
      ["—", "Rollen", "Daten werden geladen", "info"],
      ["—", "Ohne Arbeitsbereich", "Daten werden geladen", "info"],
      ["—", "Auditstatus", "Daten werden geladen", "info"],
    ],
  },
  configuration: {
    module: "admin",
    child: "Konfiguration",
    eyebrow: "Administration",
    title: "Konfiguration",
    description: "Systemweite Einstellungen, Integrationen und Aufbewahrung sicher pflegen.",
    action: "Einstellung ändern",
    kpis: [
      ["—", "Einstellungen aktiv", "Daten werden geladen", "info"],
      ["—", "Datenbankstand", "Daten werden geladen", "info"],
      ["—", "Prüfung empfohlen", "Daten werden geladen", "info"],
      ["—", "Protokolleinträge", "Daten werden geladen", "info"],
    ],
  },
};

export type LeadershipView = "organization" | "users" | "configuration";

export type Tone = "stable" | "attention" | "critical" | "info";
