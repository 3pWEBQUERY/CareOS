"use client";

import { PersonalSummary } from "../../components/personal-ui";
import type { LearningViewState } from "./use-learning-view";

export function LearningSummary({ r }: { r: LearningViewState }) {
  const { compliance, now, data, trainings, active, completedCount, rows, valid, percent } = r;
  return (
    <PersonalSummary
      items={
        compliance
          ? [
              { icon: "docs", value: String(valid), label: "Nachweise gültig" },
              {
                icon: "alert",
                value: String(rows.filter((r) => r.state === "due_soon").length),
                label: "bald fällig",
                tone: "attention",
              },
              {
                icon: "alert",
                value: String(rows.filter((r) => r.state === "missing" || r.state === "expired").length),
                label: "offen oder abgelaufen",
                tone: "critical",
              },
              { icon: "check", value: data ? `${percent} %` : "–", label: "Vollständigkeit" },
            ]
          : [
              { icon: "learn", value: String(active.length), label: "Kurse aktiv" },
              {
                icon: "check",
                value: active.length
                  ? `${Math.round(active.reduce((s, t) => s + (t.enrollment?.progress ?? 0), 0) / active.length)} %`
                  : "–",
                label: "Fortschritt aktiver Kurse",
                tone: "info",
              },
              {
                icon: "calendar",
                value: String(
                  trainings.flatMap((t) => t.sessions).filter((s) => s.mine && Date.parse(s.startsAt) > now).length,
                ),
                label: "Termine geplant",
                tone: "attention",
              },
              { icon: "docs", value: String(completedCount), label: "Nachweise" },
            ]
      }
    />
  );
}
