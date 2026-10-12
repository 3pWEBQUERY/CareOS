"use client";

import { formatDate, formatDateTime } from "@/app/components/workspace-ui";
import { STATUS_LABELS, type Wound } from "@/lib/wounds-shared";

export const FILTERS = ["Alle", "Überfällig", "In Behandlung", "Heilend", "Abgeschlossen"] as const;

export type Dialog =
  | { kind: "wound"; wound: Wound | null; residentId?: string; observationId?: string }
  | { kind: "entry"; wound: Wound }
  | { kind: "close"; wound: Wound }
  | null;

export function statusText(wound: Wound) {
  if (wound.status === "closed") return STATUS_LABELS.closed;
  if (wound.overdue) return "Überfällig";
  if (wound.latest?.infectionSigns) return "Infektionszeichen";
  return STATUS_LABELS[wound.status];
}

// „seit 3 Std.“ / „seit 2 Tagen“ – wie lange die Versorgung schon fällig ist.
export function overdueSince(nextCareAt: string | null, now: number) {
  if (!nextCareAt) return "";
  const hours = Math.max(0, Math.floor((now - Date.parse(nextCareAt)) / 3_600_000));
  if (hours < 1) return "seit weniger als 1 Std.";
  if (hours < 24) return `seit ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `seit ${days} ${days === 1 ? "Tag" : "Tagen"}`;
}

export function nextCareLabel(wound: Wound) {
  if (wound.status === "closed") return `Abgeschlossen ${formatDate(wound.closedAt)}`;
  if (!wound.nextCareAt) return "Kein Intervall festgelegt";
  return `${wound.overdue ? "Überfällig seit" : "Fällig"} ${formatDateTime(wound.nextCareAt)}`;
}
