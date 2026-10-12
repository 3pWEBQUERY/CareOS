"use client";

import { useEffect } from "react";
import { usePersonalPreferences } from "./appearance";
import { clearOfflineData } from "./offline-queue";

const ACTIVITY_KEY = "carecore:last-activity";
const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

const readShared = () => {
  try {
    return Number(window.localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeShared = (value: number) => {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(value));
  } catch {
    // Ohne Speicher zählt nur die Aktivität in diesem Tab.
  }
};

// Automatische Abmeldung (Einstellungen › Sicherheit): Nach der gewählten Zeit ohne Bedienung – in keinem Tab
// dieses Browsers – wird die Sitzung beendet und die Anmeldeseite geöffnet. Vorgemerkte Offline-Einträge bleiben.
export function IdleLogout() {
  const minutes = usePersonalPreferences()?.autoLogout ?? 0;
  useEffect(() => {
    if (!minutes) return;
    const limit = minutes * 60_000;
    let last = Date.now();
    let written = 0;
    const touch = () => {
      last = Date.now();
      // Höchstens alle 15 Sekunden in den gemeinsamen Speicher schreiben.
      if (last - written > 15_000) {
        written = last;
        writeShared(last);
      }
    };
    touch();
    const check = async () => {
      const latest = Math.max(last, readShared());
      if (Date.now() - latest < limit) return;
      window.clearInterval(timer);
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
      clearOfflineData();
      window.location.replace("/?abgemeldet=inaktiv");
    };
    const timer = window.setInterval(() => void check(), 30_000);
    const onVisible = () => document.visibilityState === "visible" && void check();
    for (const name of EVENTS) window.addEventListener(name, touch, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      for (const name of EVENTS) window.removeEventListener(name, touch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [minutes]);
  return null;
}
