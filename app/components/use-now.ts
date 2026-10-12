import { useSyncExternalStore } from "react";

// Aktuelle Zeit für Angaben wie „diese Woche“ oder „seit 7 Tagen“: einmal je Minute aktualisiert, für alle
// Komponenten gemeinsam, damit das Rendern rein bleibt (kein Date.now() im Rendern selbst).
const MINUTE = 60_000;
const listeners = new Set<() => void>();
let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  now = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(tick, MINUTE);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function snapshot() {
  if (!now) now = Date.now();
  return now;
}

export function useNow() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
