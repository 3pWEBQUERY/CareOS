"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDate,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import type { DueItem } from "@/lib/assessments";
import { initials } from "@/lib/medication-shared";
import AssessmentDialog from "./assessment-dialog";
import { Overview, kindLabel, kindTone, DUE_FILTERS } from "./assessment-view-utils";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

export function DueView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const due = useApiData<{ items: DueItem[]; canWrite: boolean }>("/api/assessments/due");
  const overview = useApiData<Overview>("/api/assessments");
  const [filter, setFilter] = useState<(typeof DUE_FILTERS)[number]>("Alle");
  const [starting, setStarting] = useState<DueItem | null>(null);
  const items = due.data?.items ?? [];
  const filtered = items.filter((item) => filter === "Alle" || kindLabel[item.kind] === filter);
  const count = (kind: DueItem["kind"]) => items.filter((i) => i.kind === kind).length;

  return (
    <>
      <PageHeading
        eyebrow="Einschätzungen"
        title="Fälligkeiten"
        description="Überfällige und in den nächsten 7 Tagen fällige Neueinschätzungen sowie fehlende Basis-Assessments."
      />
      <SummaryTiles
        label="Fälligkeiten"
        tiles={[
          { icon: "alert", value: count("overdue"), caption: "überfällig", tone: "critical" },
          { icon: "calendar", value: count("due"), caption: "in den nächsten 7 Tagen", tone: "attention" },
          { icon: "assess", value: count("missing"), caption: "Basis-Assessments fehlen", tone: "info" },
          { icon: "note", value: count("open"), caption: "offene Entwürfe" },
        ]}
      />
      {due.error && <LoadError message={due.error} onRetry={due.reload} />}
      <section className="card assessments-card">
        <div className="operations-toolbar">
          <div>
            <h2 className="card-title">Anstehende Einschätzungen</h2>
            <p className="card-subtitle">
              {filtered.length} von {items.length} Einträgen
            </p>
          </div>
          <div className="operations-filter-buttons">
            {DUE_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? "active" : ""}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="assessment-table-head">
          <span>{t.one}</span>
          <span>Instrument</span>
          <span>Status</span>
          <span>Fällig</span>
          <span />
        </div>
        <div className="assessment-list">
          {filtered.map((item) => (
            <article key={`${item.residentId}-${item.code}-${item.kind}`}>
              <span className="resident-avatar">{initials(item.residentName)}</span>
              <span>
                <strong>
                  {item.residentName} <ResuscitationBadge residentId={item.residentId} />
                </strong>
                <small>{item.room}</small>
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.lastCompletedAt ? `Zuletzt ${formatDate(item.lastCompletedAt)}` : "Noch keine Einschätzung"}
                </small>
              </span>
              <span className={`status-badge ${kindTone[item.kind]}`}>{kindLabel[item.kind]}</span>
              <span>
                <strong>{item.dueOn ? formatDate(item.dueOn) : "–"}</strong>
              </span>
              {due.data?.canWrite && overview.data?.instruments.some((instrument) => instrument.code === item.code) ? (
                <button className="quiet-button" type="button" onClick={() => setStarting(item)}>
                  Erfassen
                </button>
              ) : (
                <span />
              )}
            </article>
          ))}
          {!due.loading && !filtered.length && (
            <EmptyState icon="check" title="Nichts fällig" text="Alle Einschätzungen sind aktuell." />
          )}
          {due.loading && !due.data && <p className="list-hint">Fälligkeiten werden geladen …</p>}
        </div>
      </section>
      {starting && overview.data && (
        <AssessmentDialog
          instruments={overview.data.instruments}
          residents={overview.data.residents}
          residentId={starting.residentId}
          instrument={starting.code}
          onClose={() => setStarting(null)}
          onSaved={(message) => {
            setStarting(null);
            showToast(message);
            due.reload();
            overview.reload();
          }}
        />
      )}
    </>
  );
}
