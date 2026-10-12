"use client";

import { useEffect, useState } from "react";
import type { UserPreferences } from "@/lib/user-settings-shared";
import { useWorkContext } from "./care-context";
import { LANGUAGE_EVENT, activeLanguage, reviewing } from "./translator";

const PREFERENCES_EVENT = "carecore:preferences";
// Merkt sich das Erscheinungsbild im Browser, damit es beim nächsten Laden vor der Anzeige gilt (app/layout.tsx).
export const THEME_KEY = "carecore-theme";

function apply(preferences: Pick<UserPreferences, "textSize" | "contrast" | "motion" | "theme" | "language">) {
  const root = document.documentElement;
  // Andere Sprache gewählt (auch auf einem anderen Gerät): die Übersetzung lädt die Seite neu.
  // Während der Vorschau zum Prüfen (Administration) bleibt die gewählte Vorschausprache.
  if (preferences.language && preferences.language !== activeLanguage() && !reviewing())
    window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: preferences.language }));
  root.classList.toggle("theme-dark", preferences.theme === "dark");
  try {
    if (preferences.theme === "dark") localStorage.setItem(THEME_KEY, "dark");
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // Ohne Speicher gilt das Erscheinungsbild erst nach dem Laden der Einstellungen.
  }
  root.classList.toggle("text-large", preferences.textSize === "large");
  root.classList.toggle("text-xlarge", preferences.textSize === "xlarge");
  root.classList.toggle("contrast-high", preferences.contrast === "high");
  root.classList.toggle("motion-reduced", preferences.motion === "reduced");
}

// Changed in the settings: applied at once, without reloading the page.
export const announcePreferences = (preferences: UserPreferences) =>
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: preferences }));

// Applies the personal appearance settings (text size, contrast, animations, theme) to the page.
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
