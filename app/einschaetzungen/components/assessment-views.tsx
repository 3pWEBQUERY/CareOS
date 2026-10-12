"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDate,
  formatDateTime,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import type { AssessmentResult } from "@/lib/assessments";
import AssessmentDialog from "./assessment-dialog";
import { Overview, ALL, RISK_FILTERS, toneFor } from "./assessment-view-utils";
import { HistoryPanel } from "./assessment-history-panel";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

export function OverviewView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const data = useApiData<Overview>("/api/assessments");
  const [instrument, setInstrument] = useState(ALL);
  const [risk, setRisk] = useState<(typeof RISK_FILTERS)[number]>("Alle");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<AssessmentResult | null>(null);
  const residents = data.data?.residents ?? [];
  const latest = data.data?.latest ?? [];
  const nameOf = (id: string) => residents.find((r) => r.id === id);
  const today = todayInZurich();
  const needle = query.trim().toLocaleLowerCase("de-CH");
  const filtered = latest.filter(
    (r) =>
      (instrument === ALL || r.name === instrument) &&
      (risk === "Alle" || r.tone === toneFor(risk)) &&
      `${nameOf(r.residentId)?.name ?? ""} ${r.name}`.toLocaleLowerCase("de-CH").includes(needle),
  );

  return (
    <>
      <PageHeading
        eyebrow="Einschätzungen"
        title="Einschätzungen"
        description="Standardisierte Assessments mit automatisch berechnetem Ergebnis – jeweils die letzte gültige Einschätzung."
        action={data.data?.canWrite ? { label: "Einschätzung erfassen", onClick: () => setCreating(true) } : undefined}
      />
      <SummaryTiles
        label="Einschätzungen im Haus"
        tiles={[
          { icon: "assess", value: latest.length, caption: "aktuelle Ergebnisse" },
          {
            icon: "alert",
            value: latest.filter((r) => r.tone === "critical").length,
            caption: "mit hohem Risiko",
            tone: "critical",
          },
          {
            icon: "calendar",
            value: latest.filter((r) => r.nextDueOn && r.nextDueOn < today).length,
            caption: "Neueinschätzung überfällig",
            tone: "attention",
          },
          {
            icon: "residents",
            value: `${new Set(latest.map((r) => r.residentId)).size}/${residents.length}`,
            caption: `${t.many} eingeschätzt`,
            tone: "info",
          },
        ]}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <section className="card assessments-card">
        <div className="operations-toolbar">
          <div>
            <h2 className="card-title">Aktuelle Ergebnisse</h2>
            <p className="card-subtitle">
              {filtered.length} von {latest.length} Ergebnissen
            </p>
          </div>
          <label className="resident-search">
            <ModuleIcon name="search" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`${t.one} oder Instrument`}
              aria-label="Einschätzungen durchsuchen"
            />
          </label>
          <CareSelect
            label="Instrument"
            value={instrument}
            options={[ALL, ...new Set(latest.map((r) => r.name))]}
            onChange={setInstrument}
          />
          <div className="operations-filter-buttons">
            {RISK_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                className={risk === item ? "active" : ""}
                aria-pressed={risk === item}
                onClick={() => setRisk(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="assessment-table-head">
          <span>{t.one}</span>
          <span>Instrument</span>
          <span>Ergebnis</span>
          <span>Eingeschätzt</span>
          <span />
        </div>
        <div className="assessment-list">
          {filtered.map((result) => {
            const resident = nameOf(result.residentId);
            return (
              <article key={result.id}>
                <span className="resident-avatar">{resident?.initials ?? "?"}</span>
                <span>
                  <strong>
                    {resident?.name ?? "Unbekannt"} <ResuscitationBadge residentId={result.residentId} />
                  </strong>
                  <small>{resident?.room}</small>
                </span>
                <span>
                  <strong>{result.name}</strong>
                  <small>{result.score === null ? "–" : `${result.score} Punkte`}</small>
                </span>
                <span className={`status-badge ${result.tone}`}>{result.riskLabel ?? "Erfasst"}</span>
                <span>
                  <strong>{formatDateTime(result.completedAt)}</strong>
                  <small className={result.nextDueOn && result.nextDueOn < today ? "status-text critical" : ""}>
                    {result.nextDueOn ? `Nächste: ${formatDate(result.nextDueOn)}` : (result.assessor ?? "")}
                  </small>
                </span>
                <button className="quiet-button" type="button" onClick={() => setViewing(result)}>
                  Verlauf
                </button>
              </article>
            );
          })}
          {!data.loading && !filtered.length && (
            <EmptyState
              icon="assess"
              title={latest.length ? "Keine Ergebnisse gefunden" : "Noch keine Einschätzungen"}
              text={latest.length ? "Filter anpassen." : "Über „Einschätzung erfassen“ starten."}
            />
          )}
          {data.loading && !data.data && <p className="list-hint">Einschätzungen werden geladen …</p>}
        </div>
      </section>
      {creating && data.data && (
        <AssessmentDialog
          instruments={data.data.instruments}
          residents={residents}
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false);
            showToast(message);
            data.reload();
          }}
        />
      )}
      {viewing && (
        <HistoryPanel
          instruments={data.data?.instruments ?? []}
          result={viewing}
          residentName={nameOf(viewing.residentId)?.name ?? ""}
          canWrite={data.data?.canWrite ?? false}
          residents={residents}
          showToast={showToast}
          onChanged={data.reload}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}
