// Sprachen der Oberfläche. Deutsch ist die Ausgangssprache; die übrigen werden übersetzt und von der Administration
// geprüft und freigegeben.

export const LANGUAGES = {
  de: { label: "Deutsch", english: "German" },
  fr: { label: "Français", english: "French" },
  it: { label: "Italiano", english: "Italian" },
  en: { label: "English", english: "English" },
  sq: { label: "Shqip", english: "Albanian" },
  hr: { label: "Hrvatski", english: "Croatian" },
  sr: { label: "Srpski (latinica)", english: "Serbian (Latin script)" },
  hu: { label: "Magyar", english: "Hungarian" },
} as const;
export type Language = keyof typeof LANGUAGES;
export const LANGUAGE_KEYS = Object.keys(LANGUAGES) as Language[];
export const TARGET_LANGUAGES = LANGUAGE_KEYS.filter((key) => key !== "de") as Exclude<Language, "de">[];
export const isLanguage = (value: unknown): value is Language => typeof value === "string" && value in LANGUAGES;

export type TranslationStatus = "missing" | "draft" | "reviewed";

// Wörterbuch für die Oberfläche: Texte und Muster (mit {0}, {1} …) → Übersetzung.
export type Dictionary = { strings: Record<string, string>; patterns: Record<string, string> };

export type LanguageState = {
  locale: Language;
  released: boolean;
  total: number;
  reviewed: number;
  drafts: number;
};

export type TranslationEntry = {
  source: string;
  pattern: boolean;
  target: string;
  status: TranslationStatus;
  origin: "ai" | "manual" | null;
  updatedAt: string | null;
  updatedBy: string | null;
};
