"use client";

import { useEffect, useState } from "react";
import type { UserPreferences } from "@/lib/user-settings-shared";
import { useWorkContext } from "./care-context";
import { LANGUAGE_EVENT, activeLanguage, reviewing } from "./translator";

const PREFERENCES_EVENT = "carecore:preferences";

function apply(preferences: Pick<UserPreferences, "textSize" | "contrast" | "motion" | "language">) {
  const root = document.documentElement;
  // Andere Sprache gewählt (auch auf einem anderen Gerät): die Übersetzung lädt die Seite neu.
  // Während der Vorschau zum Prüfen (Administration) bleibt die gewählte Vorschausprache.
  if (preferences.language && preferences.language !== activeLanguage() && !reviewing())
    window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: preferences.language }));
  // CareOS ist immer dunkles Glas; die frühere Wahl „Hell/Dunkel“ ist ohne Wirkung (Rest aus früheren Fassungen).
  root.classList.remove("theme-dark");
  try {
    localStorage.removeItem("carecore-theme");
  } catch {
    // Ohne Speicher nichts aufzuräumen.
  }
  root.classList.toggle("text-large", preferences.textSize === "large");
  root.classList.toggle("text-xlarge", preferences.textSize === "xlarge");
  root.classList.toggle("contrast-high", preferences.contrast === "high");
  root.classList.toggle("motion-reduced", preferences.motion === "reduced");
}

// Changed in the settings: applied at once, without reloading the page.
export const announcePreferences = (preferences: UserPreferences) =>
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: preferences }));

// Applies the personal appearance settings (text size, contrast, animations) to the page.
export function PersonalAppearance() {
  const preferences = useWorkContext()?.preferences;
  useEffect(() => {
    if (preferences) apply(preferences);
  }, [preferences]);
  useEffect(() => {
    const onChange = (event: Event) => apply((event as CustomEvent<UserPreferences>).detail);
    window.addEventListener(PREFERENCES_EVENT, onChange);
    return () => window.removeEventListener(PREFERENCES_EVENT, onChange);
  }, []);
  return null;
}

// Persönliche Einstellungen der angemeldeten Person; Änderungen in den Einstellungen gelten sofort.
export function usePersonalPreferences() {
  const fromContext = useWorkContext()?.preferences ?? null;
  const [changed, setChanged] = useState<UserPreferences | null>(null);
  useEffect(() => {
    const onChange = (event: Event) => setChanged((event as CustomEvent<UserPreferences>).detail);
    window.addEventListener(PREFERENCES_EVENT, onChange);
    return () => window.removeEventListener(PREFERENCES_EVENT, onChange);
  }, []);
  return changed ?? fromContext;
}
