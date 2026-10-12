"use client";

import Link from "next/link";
import { useState } from "react";
import { setCareResident, useTerms, useWorkContext } from "@/app/components/care-context";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import { LoadError, formatDateTime, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import { SERVICE_SOURCES, formatMinutes, type ServiceReport } from "@/lib/services-shared";
import { LeadershipHeading, LeadershipKpis } from "../../components/leadership-page-parts";

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

// Die letzten zwölf Monate, der laufende zuerst.
function recentMonths() {
  const [year, month] = todayInZurich().split("-").map(Number);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return { value, label: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}` };
  });
}

const cell = (text: string | number) => `"${String(text).replaceAll('"', '""')}"`;
const toCsv = (rows: Array<Array<string | number>>) => rows.map((row) => row.map(cell).join(";")).join("\r\n");

function download(name: string, content: string) {
  const blob = new Blob([`﻿${content}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Leitung › Qualität & Kennzahlen › Leistungsauswertung: erfasste Zeit je Person und Bereich im Monat, mit Export.
export default function ServicesReportView() {
  const t = useTerms();
  const context = useWorkContext();
  const months = recentMonths();
  const [month, setMonth] = useState(months[0].value);
  const [unitId, setUnitId] = useState("");
  const query = new URLSearchParams({ month });
  if (unitId) query.set("careUnitId", unitId);
  const data = useApiData<ServiceReport>(`/api/services/report?${query}`);
  const report = data.data?.month === month ? data.data : null;
  const units = context?.careUnits ?? [];
  const unitName = units.find((unit) => unit.id === unitId)?.name ?? "Alle Wohnbereiche";
  const monthLabel = months.find((item) => item.value === month)?.label ?? month;

  function exportRows() {
    if (!report) return;
    download(
      `leistungen-${report.month}.csv`,
      toCsv([
        [t.one, "Erbracht am", "Leistung", "Bereich", "Code", "Minuten", "Erfasst von", "Quelle"],
        ...report.rows.map((row) => [
          row.residentName,
          formatDateTime(row.performedAt),
          row.title,
          row.category,
          row.code,
          row.minutes,
          row.performedBy,
          SERVICE_SOURCES[row.source],
        ]),
      ]),
    );
  }

  function exportSums() {
    if (!report) return;
    download(
      `leistungen-summen-${report.month}.csv`,
      toCsv([
        ["Monat", monthLabel],
        ["Bereich", unitName],
        [],
        [t.one, "Zimmer", "Wohnbereich", "Leistungen", "Minuten gesamt", ...report.categories],
        ...report.residents.map((resident) => [
          resident.name,
          resident.room,
          resident.careUnit,
          resident.count,
          resident.minutes,
          ...report.categories.map((category) => resident.byCategory[category] ?? 0),
        ]),
      ]),
    );
  }

  return (
    <ModulePageShell activeModule="quality" activeChild="Leistungsauswertung" pageClass="leadership-page">
      {() => (
        <main className="workspace leadership-workspace services-report-page">
          <LeadershipHeading
            eyebrow="Qualität & Kennzahlen"
            title="Leistungsauswertung"
            description={`Erfasste Pflegeleistungen je ${t.one} und Bereich im Monat, ohne stornierte Leistungen.`}
            action={
              report?.count ? { label: "Einzelleistungen als CSV", icon: "docs", onClick: exportRows } : undefined
            }
          />
          <section className="services-report-toolbar">
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
            <button className="secondary-button" type="button" disabled={!report?.count} onClick={exportSums}>
              Summen als CSV
            </button>
            <p>
              Der Export dient als Grundlage, z. B. für Einstufung und Abrechnung. CareOS berechnet daraus weder eine
              Pflegestufe noch eine Rechnung; massgebend bleiben die Instrumente und Tarife der Einrichtung.
            </p>
          </section>
          {data.error && <LoadError message={data.error} onRetry={data.reload} />}
          {!report && !data.error && <p className="services-report-empty">Auswertung wird erstellt…</p>}
          {report && (
            <>
              <LeadershipKpis
                kpis={[
                  { value: formatMinutes(report.minutes), label: "Erfasste Zeit", note: monthLabel },
                  { value: String(report.count), label: "Leistungen", note: unitName },
                  { value: String(report.residents.length), label: `${t.many} mit Leistungen`, note: monthLabel },
                ]}
              />
              <section className="card services-report-card" aria-label={`Leistungen je ${t.one}`}>
                <header>
                  <h2 className="card-title">Leistungen je {t.one}</h2>
                  <p className="card-subtitle">
                    {monthLabel} · {unitName}
                  </p>
                </header>
                {report.residents.length ? (
                  <div className="services-report-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{t.one}</th>
                          <th>Leistungen</th>
                          {report.categories.map((category) => (
                            <th key={category}>{category}</th>
                          ))}
                          <th>Gesamt</th>
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
                            <td>{resident.count}</td>
                            {report.categories.map((category) => (
                              <td key={category}>
                                {resident.byCategory[category] ? formatMinutes(resident.byCategory[category]) : "–"}
                              </td>
                            ))}
                            <td>
                              <strong>{formatMinutes(resident.minutes)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="services-report-empty">In diesem Monat sind keine Leistungen erfasst.</p>
                )}
              </section>
            </>
          )}
        </main>
      )}
    </ModulePageShell>
  );
}
