"use client";

import { useEffect, useRef } from "react";
import { setCareResident } from "./care-context";
import { routeFor, sidebarNavigation, type ModuleIconName } from "./navigation";

// Universelle Aktionen: einmal beschrieben, genutzt von den Schnellaktionen (mobil) und der Suche (⌘K).
// Eine Aktion führt zur Seite des Moduls; kann die Seite die Erfassung direkt öffnen, meldet sie sich über
// `useActionRequest` und öffnet den Dialog für die Person aus der Kopfzeile.

export type ActionId = "doc" | "vitals" | "fluid" | "prn" | "wound" | "handover";

export type CareAction = {
  id: ActionId;
  // Kurz für die Schnellaktionen, ausführlich für die Suche.
  label: string;
  title: string;
  icon: ModuleIconName;
  moduleId: string;
  child: string;
  keywords: string[];
};

export const CARE_ACTIONS: CareAction[] = [
  {
    id: "doc",
    label: "Dokumentation",
    title: "Dokumentieren",
    icon: "note",
    moduleId: "chart",
    child: "Schnelldokumentation",
    keywords: ["doku", "dokumentation", "dokumentieren", "eintrag", "bericht"],
  },
  {
    id: "vitals",
    label: "Vitalwerte",
    title: "Vitalwerte erfassen",
    icon: "vitals",
    moduleId: "vitals",
    child: "Vitalwerte",
    keywords: [
      "vital",
      "vitalwerte",
      "messung",
      "blutdruck",
      "puls",
      "temperatur",
      "gewicht",
      "blutzucker",
      "sättigung",
    ],
  },
  {
    id: "fluid",
    label: "Trinkmenge",
    title: "Trinkmenge erfassen",
    icon: "nutrition",
    moduleId: "nutrition",
    child: "Trinkprotokoll",
    keywords: ["trinken", "trinkmenge", "flüssigkeit", "getränk", "trinkprotokoll"],
  },
  {
    id: "prn",
    label: "Reservegabe",
    title: "Reservegabe",
    icon: "med",
    moduleId: "med",
    child: "Reserven",
    keywords: ["reserve", "reservegabe", "prn", "bedarf", "bedarfsmedikation"],
  },
  {
    id: "wound",
    label: "Wundverlauf",
    title: "Wundverlauf dokumentieren",
    icon: "wounds",
    moduleId: "wounds",
    child: "Dokumentation",
    keywords: ["wunde", "wundverlauf", "verband", "verbandswechsel"],
  },
  {
    id: "handover",
    label: "Übergabenotiz",
    title: "Übergabepunkt erfassen",
    icon: "handover",
    moduleId: "shift",
    child: "Übergabe",
    keywords: ["übergabe", "übergabenotiz", "übergabepunkt", "notiz"],
  },
];

// Aktionen, deren Modul die Person nutzen darf.
export function availableActions(permissions: string[] | undefined) {
  const allowed = new Set(sidebarNavigation(permissions).flatMap((group) => group.modules.map((module) => module.id)));
  return CARE_ACTIONS.filter((action) => allowed.has(action.moduleId) && routeFor(action.moduleId, action.child));
}

// Passt ein Suchwort zur Aktion? Wortanfang von Bezeichnung oder Stichwort.
export function actionMatches(action: CareAction, token: string) {
  const words = [...`${action.label} ${action.title}`.toLocaleLowerCase("de-CH").split(/\s+/), ...action.keywords];
  return words.some((word) => word.startsWith(token));
}

const PENDING_KEY = "carecore.pendingAction";
const PENDING_EVENT = "carecore:action";
// Eine gemerkte Aktion gilt nur kurz, damit ein späterer Besuch der Seite nicht unerwartet einen Dialog öffnet.
const PENDING_MS = 15_000;

type Pending = { id: ActionId; at: number };

function takePending(id: ActionId) {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return false;
    const pending = JSON.parse(raw) as Pending;
    if (pending.id !== id) return false;
    window.sessionStorage.removeItem(PENDING_KEY);
    return Date.now() - pending.at < PENDING_MS;
  } catch {
    return false;
  }
}

// Aktion ausführen: optional Person setzen, Aktion merken, zur Seite wechseln.
export function runAction(action: CareAction, navigate: (href: string) => void, residentId?: string) {
  if (residentId) setCareResident(residentId);
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: action.id, at: Date.now() } satisfies Pending));
  } catch {
    // Ohne Speicher öffnet sich nur die Seite.
  }
  window.dispatchEvent(new CustomEvent(PENDING_EVENT, { detail: action.id }));
  const href = routeFor(action.moduleId, action.child);
  if (href) navigate(href);
}

// Auf der Zielseite: öffnet die Erfassung, wenn die Aktion angefordert wurde (beim Laden oder während die Seite offen ist).
export function useActionRequest(id: ActionId, open: () => void, enabled = true) {
  const handler = useRef(open);
  useEffect(() => {
    handler.current = open;
  });
  useEffect(() => {
    if (!enabled) return;
    if (takePending(id)) handler.current();
    const listener = (event: Event) => {
      if ((event as CustomEvent<ActionId>).detail === id && takePending(id)) handler.current();
    };
    window.addEventListener(PENDING_EVENT, listener);
    return () => window.removeEventListener(PENDING_EVENT, listener);
  }, [id, enabled]);
}
