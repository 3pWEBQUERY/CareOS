"use client";

import Link from "next/link";
import { useState } from "react";
import { setCareResident, useTerms, useWorkContext } from "@/app/components/care-context";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import {
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDate,
  todayInZurich,
  useApiData,
} from "@/app/components/workspace-ui";
import type { ActivityReport } from "@/lib/activities-shared";

const MONTH_NAMES = [
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

function recentMonths() {
  const [year, month] = todayInZurich().split("-").map(Number);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return { value, label: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}` };
  });
}

// Alltag & Aktivierung › Teilnahme je Person: was im Monat erfasst ist, ohne Vorgabe, wie viel es sein soll.
export default function ParticipationReportView() {
  const t = useTerms();
  const context = useWorkContext();
  const units = context?.careUnits ?? [];
  const months = recentMonths();
  const [month, setMonth] = useState(months[0].value);
  const [unitId, setUnitId] = useState("");
  const query = new URLSearchParams({ month });
  if (unitId) query.set("careUnitId", unitId);
  const data = useApiData<ActivityReport>(`/api/activities/report?${query}`);
  const report = data.data?.month === month && data.data.careUnitId === (unitId || null) ? data.data : null;
  const monthLabel = months.find((item) => item.value === month)?.label ?? month;
  const unitName = units.find((unit) => unit.id === unitId)?.name ?? "Alle Wohnbereiche";

  function exportCsv() {
    if (!report) return;
    const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows: Array<Array<string | number>> = [
      ["Monat", monthLabel],
      ["Bereich", unitName],
      [],
      [t.one, "Zimmer", "Wohnbereich", "Teilgenommen", "Abgelehnt", "Nicht anwesend", ...report.categories, "Zuletzt"],
      ...report.residents.map((resident) => [
        resident.name,
        resident.room,
        resident.careUnit,
        resident.counts.participated,
        resident.counts.declined,
        resident.counts.absent,
        ...report.categories.map((category) => resident.byCategory[category] ?? 0),
        resident.lastParticipation ? formatDate(resident.lastParticipation) : "",
      ]),
    ];
    const blob = new Blob([`﻿${rows.map((row) => row.map(cell).join(";")).join("\r\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `teilnahme-${report.month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const participations = report?.residents.reduce((sum, resident) => sum + resident.counts.participated, 0) ?? 0;
  const reached = report?.residents.filter((resident) => resident.counts.participated > 0).length ?? 0;

  return (
    <ModulePageShell activeModule="activities" activeChild="Teilnahme je Person" pageClass="activities-page">
      {() => (
        <main className="workspace module-workspace activities-workspace">
          <PageHeading
            eyebrow="Alltag & Aktivierung"
            title="Teilnahme je Person"
            description={`Erfasste Teilnahme an Angeboten je ${t.one} im Monat, mit Kategorien und Export.`}
          />
          <section className="activities-toolbar">
            <CareOptionSelect label="Monat" value={month} onChange={setMonth} options={months} />
            <CareOptionSelect
              label="Wohnbereich"
              value={unitId}
              onChange={setUnitId}
              options={[
                { value: "", label: "Alle Wohnbereiche" },
                ...units.map((unit) => ({ value: unit.id, label: unit.name })),
              ]}
            />
            <button className="secondary-button" type="button" disabled={!report} onClick={exportCsv}>
              CSV exportieren
            </button>
          </section>
          <SummaryTiles
            label="Monat"
            tiles={[
              { icon: "calendar", value: report ? report.offered : "–", caption: "Angebote im Monat" },
              { icon: "check", value: report ? participations : "–", caption: "Teilnahmen" },
              {
                icon: "residents",
                value: report ? `${reached} von ${report.residents.length}` : "–",
                caption: `${t.many} mit Teilnahme`,
              },
            ]}
          />
          {data.error && <LoadError message={data.error} onRetry={data.reload} />}
          {report && (
            <section className="card participation-report" aria-label={`Teilnahme je ${t.one}`}>
              <header>
                <h2 className="card-title">Teilnahme je {t.one}</h2>
                <p className="card-subtitle">
                  {monthLabel} · {unitName}
                  {report.cancelled ? ` · ${report.cancelled} Angebote abgesagt` : ""}
                </p>
              </header>
              <div className="services-report-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t.one}</th>
                      <th>Teilgenommen</th>
                      <th>Abgelehnt</th>
                      <th>Nicht anwesend</th>
                      {report.categories.map((category) => (
                        <th key={category}>{category}</th>
                      ))}
                      <th>Zuletzt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.residents.map((resident) => (
                      <tr key={resident.id}>
                        <td>
                          <Link
                            href={`/c/bewohner?resident=${resident.id}`}
                            onClick={() => setCareResident(resident.id)}
                          >
                            {resident.name}
                          </Link>
                          <small>{[resident.room, resident.careUnit].filter(Boolean).join(" · ")}</small>
                        </td>
                        <td>
                          <strong>{resident.counts.participated}</strong>
                        </td>
                        <td>{resident.counts.declined}</td>
                        <td>{resident.counts.absent}</td>
                        {report.categories.map((category) => (
                          <td key={category}>{resident.byCategory[category] ?? "–"}</td>
                        ))}
                        <td>{resident.lastParticipation ? formatDate(resident.lastParticipation) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      )}
    </ModulePageShell>
  );
}
