"use client";

import { TASK_PRIORITIES, TASK_STATUS, isActiveTask, type Task } from "@/lib/tasks-shared";
import { type Tone } from "./operations-ui";

export const zurichDay = (value: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(value));

export const shortDate = (value: string) =>
  new Date(value).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", timeZone: "Europe/Zurich" });

export function statusLabel(task: Task) {
  if ((task.status === "open" || task.status === "in_progress") && task.overdue) return "Überfällig";
  return TASK_STATUS[task.status];
}

export function statusTone(task: Task): Tone | "archived" {
  if (task.status === "completed") return "stable";
  if (task.status === "cancelled") return "archived";
  if (task.status === "partial" || task.status === "skipped") return "attention";
  if (task.status === "escalated" || task.overdue) return "critical";
  return TASK_PRIORITIES[task.priority].tone === "stable" ? "info" : (TASK_PRIORITIES[task.priority].tone as Tone);
}

// Abgeschlossen mit einem Ergebnis (✓ △ ✕), nicht abgebrochen.
export const isFinishedTask = (task: Pick<Task, "status">) => !isActiveTask(task.status) && task.status !== "cancelled";

export const ALL_PEOPLE = "Alle Personen";

export const UNASSIGNED = "Nicht zugewiesen";
