"use client";

import { useEffect, useState } from "react";
import { requestJson, useApiData, type ShowToast } from "@/app/components/workspace-ui";
import { type ComplianceState, type LearningPayload } from "@/lib/learning-shared";
import { ME, ALL_PEOPLE, NO_UNIT, STATE_ORDER, Dialog } from "./learning-utils";

export function useLearningView({
  compliance,
  showToast,
  dialog,
  setDialog,
  onData,
  searchRef,
}: {
  compliance: boolean;
  showToast: ShowToast;
  dialog: Dialog | null;
  setDialog: (dialog: Dialog | null) => void;
  onData: (data: LearningPayload | undefined) => void;
  searchRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [person, setPerson] = useState(ME);
  const [filter, setFilter] = useState("Alle");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [unitChoice, setUnit] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const learning = useApiData<LearningPayload>(
    `/api/learning${compliance && person !== ME ? `?userId=${person === ALL_PEOPLE ? "all" : person}` : ""}`,
  );
  const { reload } = learning;
  const data = learning.data;
  useEffect(() => onData(data), [data, onData]);
  const today = data?.today ?? "";
  const needle = query.trim().toLocaleLowerCase("de-CH");
  const done = (message: string) => {
    setDialog(null);
    showToast(message);
    reload();
  };
  const run = async (url: string, body: unknown, message: string) => {
    try {
      await requestJson(url, { method: "POST", body });
      showToast(message);
      reload();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    }
  };

  // --- Meine Schulungen ---
  const trainings = data?.trainings ?? [];
  const mine = trainings.filter((t) => t.enrollment);
  const active = mine.filter((t) => t.enrollment && t.enrollment.status !== "completed");
  const completedCount = mine.filter((t) => t.enrollment?.completedAt).length;
  const courseFilters = ["Alle", "Meine Kurse", "Pflicht", "E-Learning", "Präsenz", "Abgeschlossen"];
  const courses = trainings.filter((t) => {
    if (filter === "Meine Kurse" && !t.enrollment) return false;
    if (filter === "Pflicht" && !t.mandatory) return false;
    if (filter === "E-Learning" && t.format !== "elearning") return false;
    if (filter === "Präsenz" && t.format !== "presence") return false;
    if (filter === "Abgeschlossen" && !t.enrollment?.completedAt) return false;
    return !needle || `${t.title} ${t.description ?? ""} ${t.category}`.toLocaleLowerCase("de-CH").includes(needle);
  });
  const focusTraining =
    trainings.find((t) => t.id === selectedId) ??
    [...active].sort((a, b) => (a.enrollment?.dueOn ?? "9999").localeCompare(b.enrollment?.dueOn ?? "9999"))[0] ??
    trainings[0] ??
    null;
  const upcoming = trainings
    .flatMap((t) =>
      t.sessions.filter((s) => Date.parse(s.startsAt) > now && (showAll || s.mine)).map((s) => ({ t, s })),
    )
    .sort((a, b) => a.s.startsAt.localeCompare(b.s.startsAt));
  const dueCourses = showAll ? [] : active.filter((t) => t.enrollment?.dueOn && !t.sessions.some((s) => s.mine));

  // --- Pflichtnachweise ---
  const allRows = data?.compliance ?? [];
  // Übersicht je Team (Stammwohnbereich) für die Leitung, wenn alle Mitarbeitenden gewählt sind.
  const unitOf = new Map((data?.people ?? []).map((p) => [p.id, p.unitName ?? NO_UNIT]));
  const teams =
    compliance && person === ALL_PEOPLE
      ? [...new Set(allRows.map((row) => unitOf.get(row.userId) ?? NO_UNIT))]
          .map((name) => {
            const own = allRows.filter((row) => (unitOf.get(row.userId) ?? NO_UNIT) === name);
            const ok = own.filter((row) => row.state === "valid" || row.state === "due_soon").length;
            return {
              name,
              total: own.length,
              valid: ok,
              open: own.filter((row) => row.state === "missing" || row.state === "expired").length,
              percent: Math.round((ok / own.length) * 100),
            };
          })
          .sort((a, b) => a.percent - b.percent || a.name.localeCompare(b.name, "de-CH"))
      : [];
  const unit = teams.some((t) => t.name === unitChoice) ? unitChoice : null;
  const rows = unit ? allRows.filter((row) => (unitOf.get(row.userId) ?? NO_UNIT) === unit) : allRows;
  const complianceFilters = ["Alle", "Offen", "Bald fällig", "Abgelaufen", "Prüfung ausstehend", "Gültig"];
  const stateFor: Record<string, ComplianceState> = {
    Offen: "missing",
    "Bald fällig": "due_soon",
    Abgelaufen: "expired",
    "Prüfung ausstehend": "pending",
    Gültig: "valid",
  };
  const register = rows
    .filter((row) => filter === "Alle" || !compliance || row.state === stateFor[filter])
    .filter(
      (row) => !needle || `${row.title} ${row.userName} ${row.category}`.toLocaleLowerCase("de-CH").includes(needle),
    )
    .sort(
      (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.title.localeCompare(b.title, "de-CH"),
    );
  const focusRow = rows.find((row) => row.key === selectedId) ?? register[0] ?? null;
  const valid = rows.filter((row) => row.state === "valid" || row.state === "due_soon").length;
  const deadlines = rows
    .filter((row) => showAll || row.state !== "valid")
    .filter((row) => row.deadline || row.state === "missing")
    .sort((a, b) => (a.deadline ?? "0000").localeCompare(b.deadline ?? "0000"));
  const team = compliance && person !== ME;

  const percent = compliance
    ? rows.length
      ? Math.round((valid / rows.length) * 100)
      : 100
    : mine.length
      ? Math.round((completedCount / mine.length) * 100)
      : 0;
  return {
    compliance,
    showToast,
    dialog,
    setDialog,
    onData,
    searchRef,
    person,
    setPerson,
    filter,
    setFilter,
    query,
    setQuery,
    selectedId,
    setSelectedId,
    showAll,
    setShowAll,
    now,
    learning,
    reload,
    data,
    today,
    needle,
    done,
    run,
    trainings,
    mine,
    active,
    completedCount,
    courseFilters,
    courses,
    focusTraining,
    upcoming,
    dueCourses,
    rows,
    complianceFilters,
    stateFor,
    register,
    focusRow,
    valid,
    deadlines,
    team,
    teams,
    unit,
    setUnit,
    percent,
  };
}

export type LearningViewState = ReturnType<typeof useLearningView>;
