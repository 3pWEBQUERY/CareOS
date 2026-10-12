"use client";

import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { LoadError, formatDateTime, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import { CHECKLIST, HANDOVER_STATUS, type ShiftHistory, type ShiftHistoryEntry } from "@/lib/shift-shared";
import { Summary, formatScheduleDate } from "./operations-ui";
import { clock, zurichDay, longDate, ALL_UNITS } from "./shift-utils";

export const csvCell = (value: string | number | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export function exportHistory(entries: ShiftHistoryEntry[]) {
  const header = [
    "Datum",
    "Dienst",
    "Geplant",
    "Eingecheckt",
    "Ausgecheckt",
    "Wohnbereich",
    "Status",
    "Übergabe",
    "Dokumentationen",
    "Vitalwerte",
    "Medikamentengaben",
    "Aufgaben erledigt",
    "Übergabepunkte",
    "Notiz Start",
    "Notiz Ende",
  ];
  const rows = entries.map((entry) => [
    formatScheduleDate(zurichDay(entry.startsAt)),
    entry.name,
    `${clock(entry.startsAt)}–${clock(entry.endsAt)}`,
    entry.checkedInAt ? formatDateTime(entry.checkedInAt) : "",
    entry.checkedOutAt ? formatDateTime(entry.checkedOutAt) : "",
    entry.careUnit ?? "",
    entry.status === "completed" ? "Abgeschlossen" : entry.status === "absent" ? "Abwesend" : "Nicht abgeschlossen",
    entry.handoverStatus ? HANDOVER_STATUS[entry.handoverStatus] : "",
    entry.counts.documentation,
    entry.counts.vitals,
    entry.counts.medication,
    entry.counts.tasks,
    entry.counts.handover,
    entry.checkInNote ?? "",
    entry.checkOutNote ?? "",
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `schichtverlauf-${todayInZurich()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ShiftHistoryView({
  history,
  reload,
  days,
  setDays,
}: {
  history: ReturnType<typeof useApiData<ShiftHistory>>;
  reload: () => void;
  days: number;
  setDays: (days: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const entries = history.data?.entries ?? [];
  const totals = history.data?.totals;
  const filtered = entries.filter((entry) =>
    `${longDate(entry.startsAt)} ${entry.name} ${entry.careUnit ?? ""}`
      .toLocaleLowerCase("de-CH")
      .includes(query.trim().toLocaleLowerCase("de-CH")),
  );
  return (
    <>
      <Summary
        items={[
          { icon: "calendar", value: String(totals?.shifts ?? "–"), label: `Dienste in ${days} Tagen` },
          { icon: "check", value: String(totals?.completed ?? "–"), label: "ordentlich abgeschlossen" },
          { icon: "note", value: String(totals?.documentation ?? "–"), label: "Dokumentationen", tone: "info" },
          { icon: "alert", value: String(totals?.open ?? "–"), label: "ohne Check-out", tone: "attention" },
        ]}
      />
      {history.error && <LoadError message={history.error} onRetry={reload} />}
      <section className="card operations-list-card">
        <div className="operations-toolbar">
          <div>
            <h2 className="card-title">Abgeschlossene Dienste</h2>
            <p className="card-subtitle">
              {filtered.length} von {entries.length} Einträgen
            </p>
          </div>
          <div className="operations-filter-buttons">
            {[30, 90, 365].map((value) => (
              <button
                key={value}
                type="button"
                className={days === value ? "active" : ""}
                aria-pressed={days === value}
                onClick={() => setDays(value)}
              >
                {value === 365 ? "12 Monate" : `${value} Tage`}
              </button>
            ))}
          </div>
          <label className="resident-search">
            <ModuleIcon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Datum, Dienst oder Wohnbereich"
              aria-label="Schichtverlauf durchsuchen"
            />
          </label>
        </div>
        <div className="operations-history-list">
          {filtered.map((entry) => {
            const open = openId === entry.assignmentId;
            const [weekday, ...rest] = longDate(entry.startsAt).split(", ");
            const total = entry.counts.documentation + entry.counts.vitals + entry.counts.medication;
            return (
              <div key={entry.assignmentId} className={`shift-history-entry ${open ? "open" : ""}`}>
                <article>
                  <span className="operations-date">
                    <strong>{weekday}</strong>
                    <small>{rest.join(", ")}</small>
                  </span>
                  <span>
                    <strong>
                      {entry.checkedInAt ? clock(entry.checkedInAt) : clock(entry.startsAt)}–
                      {entry.checkedOutAt ? clock(entry.checkedOutAt) : clock(entry.endsAt)}
                    </strong>
                    <small>
                      {entry.name} · {entry.careUnit ?? ALL_UNITS}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {total} {total === 1 ? "Eintrag" : "Einträge"}
                    </strong>
                    <small>
                      Übergabe:{" "}
                      {entry.handoverStatus
                        ? HANDOVER_STATUS[entry.handoverStatus].replace("Übergabe ", "")
                        : "nicht erfasst"}
                    </small>
                  </span>
                  <span
                    className={`status-badge ${entry.status === "completed" ? "stable" : entry.status === "absent" ? "archived" : "attention"}`}
                  >
                    {entry.status === "completed"
                      ? "Abgeschlossen"
                      : entry.status === "absent"
                        ? "Abwesend"
                        : "Ohne Check-out"}
                  </span>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : entry.assignmentId)}
                  >
                    {open ? "Schliessen" : "Ansehen"} <ModuleIcon name="chevron" className={open ? "open" : ""} />
                  </button>
                </article>
                {open && (
                  <dl className="task-detail-list shift-history-detail">
                    <div>
                      <dt>Geplant</dt>
                      <dd>
                        {clock(entry.startsAt)}–{clock(entry.endsAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>Check-in / Check-out</dt>
                      <dd>
                        {entry.checkedInAt ? formatDateTime(entry.checkedInAt) : "–"} /{" "}
                        {entry.checkedOutAt ? formatDateTime(entry.checkedOutAt) : "–"}
                      </dd>
                    </div>
                    <div>
                      <dt>Dokumentiert</dt>
                      <dd>
                        {entry.counts.documentation} {entry.counts.documentation === 1 ? "Eintrag" : "Einträge"} ·{" "}
                        {entry.counts.vitals} Vitalwerte · {entry.counts.medication} Medikamentengaben
                      </dd>
                    </div>
                    <div>
                      <dt>Aufgaben & Übergabe</dt>
                      <dd>
                        {entry.counts.tasks} Aufgaben erledigt · {entry.counts.handover} Übergabepunkte geschrieben
                      </dd>
                    </div>
                    <div>
                      <dt>Start-Checkliste</dt>
                      <dd>{entry.checklist.length ? entry.checklist.map((key) => CHECKLIST[key]).join(" · ") : "–"}</dd>
                    </div>
                    <div>
                      <dt>Notizen</dt>
                      <dd>{[entry.checkInNote, entry.checkOutNote].filter(Boolean).join(" · ") || "–"}</dd>
                    </div>
                  </dl>
                )}
              </div>
            );
          })}
        </div>
        {!history.loading && filtered.length === 0 && (
          <div className="resident-empty">
            <ModuleIcon name="search" />
            <strong>Keine Dienste gefunden</strong>
            <p>
              {entries.length
                ? "Suchbegriff anpassen."
                : "Im gewählten Zeitraum liegen noch keine beendeten Dienste vor."}
            </p>
          </div>
        )}
        {history.loading && !history.data && <p className="list-hint">Schichtverlauf wird geladen …</p>}
      </section>
    </>
  );
}
