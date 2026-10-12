"use client";

import { useTerms } from "@/app/components/care-context";
import { countOf } from "@/lib/terminology";
import { useMemo, useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { LoadError, todayInZurich } from "@/app/components/workspace-ui";
import { RAI_STATE } from "@/lib/rai-shared";
import type { RaiData } from "./rai-data";
import { nextLabel, useOpenAssessment } from "./rai-overview-view";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

const inDays = (days: number) => {
  const date = new Date(`${todayInZurich()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// The CSV export is a download, not a page.
export function downloadRaiReport() {
  const link = document.createElement("a");
  link.href = "/api/rai/export";
  link.click();
}

export function DueView({ rai }: { rai: RaiData }) {
  const t = useTerms();
  const openAssessment = useOpenAssessment();
  const [filter, setFilter] = useState("Alle");
  const items = useMemo(
    () =>
      (rai.data?.residents ?? [])
        .filter((row) => row.state !== "current")
        .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999")),
    [rai.data],
  );
  if (rai.error && !rai.data) return <LoadError message={rai.error} onRetry={rai.reload} />;
  const today = todayInZurich();
  const week = inDays(7);
  const visible = items.filter(
    (item) =>
      filter === "Alle" ||
      (filter === "Heute"
        ? (item.dueOn ?? "9999") <= today
        : filter === "Diese Woche"
          ? (item.dueOn ?? "9999") <= week
          : !item.lastCompletedOn),
  );
  return (
    <section className="card rai-due-card">
      <div className="rai-card-header">
        <div>
          <p className="eyebrow">Arbeitskorb</p>
          <h2 className="card-title">Fälligkeiten</h2>
          <p className="card-subtitle">
            {rai.loading && !rai.data
              ? "Wird geladen …"
              : `${visible.length} von ${items.length} Abklärungen brauchen Aufmerksamkeit`}
          </p>
        </div>
        <div className="rai-filter-row">
          {["Alle", "Heute", "Diese Woche", "Nach Eintritt"].map((item) => (
            <button
              className={filter === item ? "active" : ""}
              type="button"
              key={item}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="rai-due-table-head">
        <span>{t.one}</span>
        <span>Grund</span>
        <span>Fällig</span>
        <span>Zuständig</span>
        <span />
      </div>
      <div className="rai-due-list">
        {visible.map((item) => (
          <article key={item.id}>
            <span className="resident-person">
              <span className="resident-avatar">{item.initials}</span>
              <span>
                <strong>
                  {item.name} <ResuscitationBadge residentId={item.id} />
                </strong>
                <small>
                  {item.room} · {item.unit}
                </small>
              </span>
            </span>
            <span>
              {item.reason}
              {item.state === "in_progress" ? ` · ${item.progress}%` : ""}
            </span>
            <span className={`status-badge ${RAI_STATE[item.state].tone}`}>
              {item.dueOn === today ? "Heute" : nextLabel(item)}
            </span>
            <span>{item.assessor ?? "–"}</span>
            <button className="quiet-button" type="button" onClick={() => openAssessment(item.id)}>
              Öffnen <ModuleIcon name="chevron" />
            </button>
          </article>
        ))}
        {rai.data && visible.length === 0 && (
          <div className="resident-empty">
            <ModuleIcon name="calendar" />
            <strong>Keine Fälligkeiten</strong>
            <p>{items.length ? "Der Filter zeigt aktuell keine Einträge." : "Alle Abklärungen sind aktuell."}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function ReportsView({ rai }: { rai: RaiData }) {
  const t = useTerms();
  const openAssessment = useOpenAssessment();
  const [selected, setSelected] = useState<string | null>(null);
  if (rai.error && !rai.data) return <LoadError message={rai.error} onRetry={rai.reload} />;
  const residents = rai.data?.residents ?? [];
  const summary = rai.data?.summary;
  const assessed = residents.filter((row) => row.needs !== null);
  const withNeeds = assessed.filter((row) => (row.needs ?? 0) > 0);
  const monthEnd = (() => {
    const date = new Date(`${todayInZurich().slice(0, 7)}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    date.setUTCDate(0);
    return date.toISOString().slice(0, 10);
  })();
  const dueThisMonth = residents.filter((row) => row.state !== "current" && (row.dueOn ?? "9999") <= monthEnd);
  const monthName = new Date().toLocaleDateString("de-CH", { month: "long", timeZone: "Europe/Zurich" });
  const reports = [
    {
      id: "complete",
      title: "Vollständigkeit im Haus",
      detail: `${residents.filter((row) => row.state === "current" || row.state === "due").length} von ${residents.length} ${t.manyDative} mit aktueller Abklärung`,
      value: summary ? `${summary.currentShare}%` : "–",
      tone: "stable",
      rows: residents.filter((row) => row.state !== "current" && row.state !== "due"),
    },
    {
      id: "need",
      title: "Handlungsbedarf festgehalten",
      detail: `${withNeeds.length} von ${assessed.length} abgeschlossenen Abklärungen mit Handlungsbedarf in mindestens einem Bereich (Entscheid der Fachperson)`,
      value: String(withNeeds.length),
      tone: "info",
      rows: [...withNeeds].sort((a, b) => (b.needs ?? 0) - (a.needs ?? 0)),
    },
    {
      id: "month",
      title: `Fälligkeiten ${monthName}`,
      detail: "Abklärungen bis Monatsende mit verantwortlicher Person",
      value: String(dueThisMonth.length),
      tone: dueThisMonth.length ? "attention" : "stable",
      rows: dueThisMonth,
    },
  ];
  const active = reports.find((report) => report.id === selected) ?? null;
  const drafts = residents.filter((row) => row.draftId);
  return (
    <div className="rai-reports-layout">
      <section className="card rai-report-grid">
        <div className="rai-card-header">
          <div>
            <p className="eyebrow">Auswertung</p>
            <h2 className="card-title">{active ? active.title : "Berichte"}</h2>
            <p className="card-subtitle">
              {active ? countOf(active.rows.length, t) : "Transparente Kennzahlen für Pflege und Leitung."}
            </p>
          </div>
          {active ? (
            <button className="secondary-button" type="button" onClick={() => setSelected(null)}>
              Zurück zur Übersicht
            </button>
          ) : (
            <button className="secondary-button" type="button" onClick={downloadRaiReport}>
              Exportieren <ModuleIcon name="docs" />
            </button>
          )}
        </div>
        {active ? (
          <div className="rai-due-list">
            {active.rows.map((row) => (
              <article key={row.id}>
                <span className="resident-person">
                  <span className="resident-avatar">{row.initials}</span>
                  <span>
                    <strong>
                      {row.name} <ResuscitationBadge residentId={row.id} />
                    </strong>
                    <small>
                      {row.room} · {row.unit}
                    </small>
                  </span>
                </span>
                <span>
                  {active.id === "need"
                    ? `${row.needs} Bereich${row.needs === 1 ? "" : "e"} mit Handlungsbedarf`
                    : row.reason}
                </span>
                <span className={`status-badge ${RAI_STATE[row.state].tone}`}>{RAI_STATE[row.state].label}</span>
                <span>{row.assessor ?? "–"}</span>
                <button className="quiet-button" type="button" onClick={() => openAssessment(row.id)}>
                  Öffnen <ModuleIcon name="chevron" />
                </button>
              </article>
            ))}
            {!active.rows.length && (
              <div className="resident-empty">
                <ModuleIcon name="check" />
                <strong>Keine Einträge</strong>
                <p>Für diesen Bericht gibt es nichts zu tun.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="rai-report-cards">
            {reports.map((report) => (
              <button type="button" className="rai-report-card" key={report.id} onClick={() => setSelected(report.id)}>
                <span className={`rai-report-value ${report.tone}`}>{report.value}</span>
                <strong>{report.title}</strong>
                <small>{report.detail}</small>
                <ModuleIcon name="chevron" />
              </button>
            ))}
          </div>
        )}
      </section>
      <aside className="card rai-report-note">
        <div className="card-header">
          <div>
            <p className="eyebrow">Datenqualität</p>
            <h2 className="card-title">Freigaben</h2>
          </div>
        </div>
        <div className="rai-report-meter">
          <span style={{ width: `${summary?.currentShare ?? 0}%` }} />
        </div>
        <strong>{summary ? `${summary.currentShare}% aktuell abgeschlossen` : "Wird geladen …"}</strong>
        <p>
          {drafts.length
            ? `${drafts.length} Entw${drafts.length === 1 ? "urf wartet" : "ürfe warten"} auf den Abschluss durch die verantwortliche Person.`
            : "Keine offenen Entwürfe."}
        </p>
        <button
          className="primary-button"
          type="button"
          disabled={!drafts.length}
          onClick={() => drafts[0] && openAssessment(drafts[0].id)}
        >
          Freigaben prüfen
        </button>
      </aside>
    </div>
  );
}
