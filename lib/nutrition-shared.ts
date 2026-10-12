// Nutrition definitions shared by the API and the client workspace.

export const DIETS = [
  "Normalkost",
  "Leichte Vollkost",
  "Diabetesangepasst",
  "Energie- und eiweissreich",
  "Natriumarm",
  "Laktosefrei",
  "Glutenfrei",
  "Vegetarisch",
] as const;
export const TEXTURES = ["Normal", "Weich", "Fein gehackt", "Püriert", "Flüssig/passiert", "Sondenernährung"] as const;
export const MEAL_RHYTHMS = [
  "3 Hauptmahlzeiten",
  "3 Haupt- und 2 Zwischenmahlzeiten",
  "5–6 kleine Mahlzeiten",
  "Individuell",
] as const;
export const ASSISTANCE = [
  "Selbständig",
  "Vorbereitung (schneiden, öffnen)",
  "Anleitung und Motivation",
  "Teilweise Unterstützung",
  "Vollständige Unterstützung",
] as const;
export const MEALS = [
  "Frühstück",
  "Zwischenmahlzeit Vormittag",
  "Mittagessen",
  "Zwischenmahlzeit Nachmittag",
  "Abendessen",
  "Spätmahlzeit",
] as const;
export const PORTIONS = [0, 25, 50, 75, 100] as const;
export const BEVERAGES = [
  "Wasser",
  "Tee",
  "Kaffee",
  "Saft",
  "Milch",
  "Suppe",
  "Angedickte Flüssigkeit",
  "Sonstiges",
] as const;

export type NutritionPlan = {
  id: string;
  diet: string | null;
  texture: string | null;
  allergies: string | null;
  fluidTargetMl: number | null;
  fluidLimitMl: number | null;
  calorieTarget: number | null;
  mealRhythm: string | null;
  assistance: string | null;
  preferences: string | null;
  instructions: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type FluidEntry = {
  id: string;
  amountMl: number;
  beverage: string | null;
  consumedAt: string;
  note: string | null;
  enteredBy: string | null;
};
export type MealEntry = {
  id: string;
  meal: string;
  portionPercent: number;
  eatenAt: string;
  note: string | null;
  enteredBy: string | null;
};

// Trendhinweis nach den Grenzen der Einrichtung (Einstellungen „Hinweis Gewichtsverlust“ und „Hinweis Trinkmenge“).
export type NutritionTrend = { kind: "weight" | "fluid"; text: string };

export type NutritionResident = {
  id: string;
  name: string;
  initials: string;
  room: string;
  careUnit: string;
  hasPlan: boolean;
  diet: string | null;
  texture: string | null;
  fluidTargetMl: number | null;
  fluidLimitMl: number | null;
  fluidTotalMl: number;
  lastFluidAt: string | null;
  mealsLogged: number;
  lowMeals: number;
  trends: NutritionTrend[];
};

export type ResidentNutrition = {
  plan: NutritionPlan | null;
  fluids: FluidEntry[];
  meals: MealEntry[];
  week: Array<{ date: string; totalMl: number }>;
  weight: { latestKg: number; measuredAt: string; changeKg30d: number | null } | null;
  trends: NutritionTrend[];
};

export type FluidStatus = "none" | "reached" | "on_track" | "behind" | "over_limit" | "no_target";

// Share of the daily target expected by now: linear between 07:00 and 21:00 (local time).
export function expectedShare(localTime: string) {
  const [h, m] = localTime.split(":").map(Number);
  const hours = h + m / 60;
  return Math.min(1, Math.max(0, (hours - 7) / 14));
}

// Past days are judged against the full target, today against the share expected by now.
export function fluidStatus(total: number, target: number | null, limit: number | null, share: number): FluidStatus {
  if (limit && total > limit) return "over_limit";
  if (!target) return "no_target";
  if (total >= target) return "reached";
  if (share < 1 && total >= target * share * 0.7) return "on_track";
  return "behind";
}

export const fluidStatusLabel: Record<FluidStatus, string> = {
  none: "Keine Einträge",
  reached: "Ziel erreicht",
  on_track: "Im Soll",
  behind: "Unter Soll",
  over_limit: "Begrenzung überschritten",
  no_target: "Kein Trinkziel",
};

export const fluidStatusTone: Record<FluidStatus, string> = {
  none: "info",
  reached: "stable",
  on_track: "stable",
  behind: "critical",
  over_limit: "critical",
  no_target: "info",
};

export const formatMl = (value: number) => `${value.toLocaleString("de-CH")} ml`;
