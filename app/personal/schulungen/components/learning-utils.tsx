"use client";

import { type ModuleIconName } from "@/app/components/module-icon";
import { formatDate, timeInZurich } from "@/app/components/workspace-ui";
import { TRAINING_FORMATS, type ComplianceRow, type ComplianceState, type Training } from "@/lib/learning-shared";

export const CATEGORY_ICONS: Record<string, ModuleIconName> = {
  Pflege: "residents",
  Medikation: "med",
  Wundmanagement: "wounds",
  Hygiene: "check",
  Notfall: "alert",
  Sicherheit: "quality",
  Kommunikation: "team",
  Organisation: "docs",
};

export const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export const ME = "Nur ich";

export const ALL_PEOPLE = "Alle Mitarbeitenden";

export const NO_UNIT = "Ohne Wohnbereich";

export const NO_SESSION = "Ohne Termin anmelden";

export const zurichDay = (value: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(value));

export const sessionLabel = (s: Training["sessions"][number]) =>
  `${formatDate(zurichDay(s.startsAt))} ${timeInZurich(new Date(s.startsAt))}–${timeInZurich(new Date(s.endsAt))}${s.location ? ` · ${s.location}` : ""}${s.capacity ? ` · ${s.booked}/${s.capacity} Plätze` : ""}`;

export function trainingState(t: Training) {
  const e = t.enrollment;
  if (e?.status === "completed") return { label: "Abgeschlossen", tone: "stable" };
  if (e?.status === "in_progress")
    return {
      label: e.quizScore !== null ? `Quiz ${e.quizScore} % · nicht bestanden` : `In Bearbeitung · ${e.progress} %`,
      tone: e.quizScore !== null ? "attention" : "info",
    };
  if (e?.assignedByName) return { label: "Zugewiesen", tone: "attention" };
  if (e) return { label: "Angemeldet", tone: "attention" };
  if (t.mandatory) return { label: "Pflicht", tone: "critical" };
  return { label: "Verfügbar", tone: "info" };
}

export function trainingMeta(t: Training, now: number) {
  const parts: string[] = [TRAINING_FORMATS[t.format]];
  if (t.durationMinutes)
    parts.push(
      t.durationMinutes >= 60
        ? `${String(Math.round((t.durationMinutes / 60) * 10) / 10).replace(".", ",")} h`
        : `${t.durationMinutes} Minuten`,
    );
  if (t.quiz) parts.push(`Quiz ab ${t.quiz.passPercent} %`);
  const booked = t.sessions.find((s) => s.mine);
  const next = t.sessions.find((s) => Date.parse(s.startsAt) > now);
  if (booked) parts.push(`Dein Termin ${formatDate(zurichDay(booked.startsAt))}`);
  else if (t.enrollment?.dueOn) parts.push(`Frist ${formatDate(t.enrollment.dueOn)}`);
  else if (next) parts.push(`Nächster Termin ${formatDate(zurichDay(next.startsAt))}`);
  return parts.join(" · ");
}

export function complianceText(row: ComplianceRow, today: string) {
  const e = row.enrollment;
  if (row.state === "missing")
    return e?.dueOn ? `Noch kein Nachweis · Frist ${formatDate(e.dueOn)}` : "Noch kein Nachweis im Kompetenzprofil.";
  if (row.state === "expired") return `Abgelaufen seit ${formatDate(e?.validUntil ?? today)}. Auffrischung nötig.`;
  if (row.state === "pending")
    return `Nachweis vom ${formatDate(e?.completedAt ?? null)} – Prüfung durch die Leitung ausstehend.`;
  if (!e?.validUntil) return `Nachweis vom ${formatDate(e?.completedAt ?? null)} · unbefristet gültig.`;
  const days = Math.round((Date.parse(e.validUntil) - Date.parse(today)) / 86_400_000);
  return row.state === "due_soon"
    ? `Läuft in ${days} Tagen ab (${formatDate(e.validUntil)}).`
    : `Gültig bis ${formatDate(e.validUntil)}.`;
}

export const STATE_ORDER: ComplianceState[] = ["expired", "missing", "due_soon", "pending", "valid"];

export const STATE_ICON: Record<ComplianceState, ModuleIconName> = {
  expired: "alert",
  missing: "alert",
  due_soon: "calendar",
  pending: "docs",
  valid: "check",
};

export async function postForm(url: string, form: FormData) {
  const response = await fetch(url, { method: "POST", body: form });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "Speichern fehlgeschlagen.");
}

export type Dialog =
  | { kind: "evidence"; trainingId: string | null; userId: string | null }
  | { kind: "enroll" | "progress" | "quiz" | "session" | "assign" | "archive"; training: Training }
  | { kind: "training"; training: Training | null };
