"use client";

import { type ModuleIconName } from "@/app/components/module-icon";
import { timeInZurich, todayInZurich } from "@/app/components/workspace-ui";
import { type ShiftType, type TimelineItem } from "@/lib/shift-shared";

export type ShiftPageView = "shift" | "shiftHistory";

export const TZ = "Europe/Zurich";

export const clock = (value: string) => timeInZurich(new Date(value));

export const zurichDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(value));

export const longDate = (value: string) =>
  new Date(value).toLocaleDateString("de-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  });

export const ALL_UNITS = "Gesamtes Haus";

export const PLANNED = "Geplanter Dienst";

export const kindIcon: Record<TimelineItem["kind"], ModuleIconName> = {
  task: "tasks",
  medication: "med",
  wound: "wounds",
  appointment: "calendar",
};

// Shift type that fits the current local time, with the start date (night shifts started yesterday).
export function suggestedShift(): { type: ShiftType; date: string } {
  const hour = Number(timeInZurich().slice(0, 2));
  if (hour < 6) {
    const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() - 86_400_000));
    return { type: "Nachtwache", date: yesterday };
  }
  const type: ShiftType = hour < 12 ? "Frühdienst" : hour < 21 ? "Spätdienst" : "Nachtwache";
  return { type, date: todayInZurich() };
}
