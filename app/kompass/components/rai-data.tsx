"use client";

import type { RaiWorkplace } from "@/lib/rai-shared";

export type RaiView = "overview" | "assessment" | "due" | "reports";

export type RaiData = {
  data?: RaiWorkplace;
  error?: string;
  loading: boolean;
  reload: () => void;
};

export const meta: Record<RaiView, { child: string; title: string; description: string; action: string }> = {
  overview: {
    child: "Übersicht",
    title: "Kompass",
    description: "Bedarfsabklärungen mit dem CareOS Kompass: wer dran ist, was fällig ist und wer verantwortlich ist.",
    action: "Neue Abklärung",
  },
  assessment: {
    child: "Abklärung",
    title: "Abklärung",
    description: "Schritt für Schritt durch alle Bereiche – mit Hinweisen aus der Akte und automatischem Speichern.",
    action: "",
  },
  due: {
    child: "Fälligkeiten",
    title: "Fälligkeiten",
    description: "Anstehende Abklärungen und offene Entwürfe im Blick behalten.",
    action: "Fälligkeiten aktualisieren",
  },
  reports: {
    child: "Berichte",
    title: "Berichte",
    description: "Auswertungen zur Datenqualität und zum Unterstützungsbedarf im Haus.",
    action: "Bericht exportieren",
  },
};
