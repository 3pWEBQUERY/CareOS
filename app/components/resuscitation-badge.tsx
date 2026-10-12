"use client";

import { useSyncExternalStore } from "react";
import { RESUSCITATION_STATUSES, type ResuscitationStatus } from "@/lib/resident-record-shared";

type Statuses = Record<string, ResuscitationStatus | null>;

// Ein gemeinsamer Stand für alle Karten einer Seite: einmal laden, nach Änderungen in den Stammdaten neu laden.
const CHANGED = "carecore:resuscitation-changed";
let statuses: Statuses | null = null;
let loading = false;
let loadedAt = 0;
const listeners = new Set<() => void>();

function load() {
  if (loading) return;
  loading = true;
  fetch("/api/residents/resuscitation", { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<{ statuses: Statuses }>) : null))
    .then((data) => {
      if (data) {
        statuses = data.statuses;
        loadedAt = Date.now();
        listeners.forEach((listener) => listener());
      }
    })
    .catch(() => undefined)
    .finally(() => {
      loading = false;
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener(CHANGED, load);
  // Älter als eine Minute oder noch nie geladen: beim Anzeigen frisch holen.
  if (!statuses || Date.now() - loadedAt > 60_000) load();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener(CHANGED, load);
  };
}

// Nach dem Speichern der Stammdaten aufrufen, damit alle Karten den neuen Stand zeigen.
export function announceResuscitationChange() {
  window.dispatchEvent(new Event(CHANGED));
}

export function useResuscitationStatus(residentId: string | null | undefined) {
  const all = useSyncExternalStore(
    subscribe,
    () => statuses,
    () => null,
  );
  if (!all || !residentId) return { known: false, status: null as ResuscitationStatus | null };
  return { known: residentId in all, status: all[residentId] ?? null };
}

// Reanimationsstatus auf einen Blick: rot „REA Nein“, grün „REA Ja“, gelb „REA ?“ (nicht erfasst).
export function ResuscitationBadge({ residentId }: { residentId: string | null | undefined }) {
  const { known, status } = useResuscitationStatus(residentId);
  if (!known) return null;
  const label = status === "dnr" ? "REA Nein" : status === "full" ? "REA Ja" : "REA ?";
  const title = status ? RESUSCITATION_STATUSES[status].label : "Reanimationsstatus nicht erfasst";
  return (
    <span className={`rea-badge ${status ?? "unknown"}`} title={title} aria-label={title} role="img">
      {label}
    </span>
  );
}
