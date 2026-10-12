"use client";

import Link from "next/link";
import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDateTime,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  VITAL_METRICS,
  formatVital,
  metricByKey,
  statusLabels,
  statusTone,
  type VitalResident,
} from "@/lib/vitals-shared";
import MeasurementDialog from "./measurement-dialog";
import { useActionRequest } from "@/app/components/actions";
import TrendChart from "./trend-chart";
import { History, FILTERS, WEEK, ClinicalNote, MeasurementList } from "./overview-parts";
import { useCareResident, useTerms, useVitalMetrics } from "@/app/components/care-context";
import { useNow } from "@/app/components/use-now";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

export type VitalsOverview = {
  residents: VitalResident[];
  careUnits: Array<{ id: string; name: string }>;
  measurementsToday: number;
  canRecord: boolean;
  canManageHouse: boolean;
  canManagePersonal: boolean;
};

// Latest out-of-range values across the house, most severe and newest first.
export function abnormalValues(residents: VitalResident[]) {
  return residents
    .flatMap((resident) =>
      Object.entries(resident.latest)
        .filter(([, v]) => v.status !== "normal")
        .map(([metric, v]) => ({ resident, metric, ...v })),
    )
    .sort((a, b) =>
      a.status === b.status ? b.measuredAt.localeCompare(a.measuredAt) : a.status === "critical" ? -1 : 1,
    );
}

export default function OverviewView({ showToast }: { showToast: ShowToast }) {
  const now = useNow();
  const metrics = useVitalMetrics();
  const t = useTerms();
  const overview = useApiData<VitalsOverview>("/api/vitals/overview");
  const [query, setQuery] = useState("");
  const [unit, setUnit] = useState("Gesamtes Haus");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Alle");
  const [selectedId, setSelectedId] = useCareResident();
  const [chosenMetric, setMetric] = useState(VITAL_METRICS[0].key);
  const metric = metrics.some((m) => m.key === chosenMetric) ? chosenMetric : metrics[0].key;
  const [days, setDays] = useState(7);
  const [dialog, setDialog] = useState<{ residentId: string | null } | null>(null);
  // Aktion „Vitalwerte erfassen“ (Schnellaktion oder Suche): Erfassung für die Person aus der Kopfzeile.
  useActionRequest("vitals", () => setDialog({ residentId: null }), !!overview.data?.canRecord);
  const residents = overview.data?.residents ?? [];
  const weekAgo = new Date(now - WEEK).toISOString();
  const stale = (r: VitalResident) => !r.lastMeasuredAt || r.lastMeasuredAt < weekAgo;
  const matchesFilter = (r: VitalResident) =>
    filter === "Alle" ||
    (filter === "Ohne Messung"
      ? stale(r)
      : r.status === ({ Kritisch: "critical", Beobachten: "attention", "Im Zielbereich": "normal" } as const)[filter]);
  const needle = query.trim().toLocaleLowerCase("de-CH");
  const filtered = residents.filter(
    (r) =>
      (unit === "Gesamtes Haus" || r.careUnit === unit) &&
      matchesFilter(r) &&
      `${r.name} ${r.room} ${r.careUnit}`.toLocaleLowerCase("de-CH").includes(needle),
  );
  const abnormal = abnormalValues(residents);
  const critical = abnormal.filter((item) => item.status === "critical");
  const selected = residents.find((r) => r.id === selectedId) ?? filtered[0] ?? residents[0] ?? null;
  const history = useApiData<History>(
    selected ? `/api/vitals/residents/${selected.id}?metric=${encodeURIComponent(metric)}&days=${days}` : null,
  );
  const definition = metricByKey(metric)!;
  const select = (residentId: string, metricKey?: string) => {
    setSelectedId(residentId);
    if (metricKey) setMetric(metricKey);
  };

  return (
    <>
      <PageHeading
        eyebrow="Vitalwerte"
        title="Vitalwerte im Überblick"
        description={`Aktuelle Messungen aller ${t.many}, Auffälligkeiten und empfohlene Kontrollen an einem Ort.`}
        action={
          overview.data?.canRecord
            ? { label: "Vitalwerte erfassen", onClick: () => setDialog({ residentId: null }) }
            : undefined
        }
      />
      <SummaryTiles
        label="Vitalwertstatus im Haus"
        tiles={[
          { icon: "residents", value: residents.length, caption: t.many },
          { icon: "vitals", value: overview.data?.measurementsToday ?? "–", caption: "Messungen heute" },
          { icon: "alert", value: abnormal.length, caption: "auffällige Werte", tone: "attention" },
          {
            icon: "calendar",
            value: residents.filter(stale).length,
            caption: "ohne Messung seit 7 Tagen",
            tone: "info",
          },
        ]}
      />
      {critical.length > 0 && (
        <section className="critical-alert vitals-alert" aria-label="Kritische Werte">
          <span className="critical-symbol">
            <ModuleIcon name="alert" />
          </span>
          <div>
            <strong>
              {critical.length} kritische{critical.length === 1 ? "r" : ""} Wert{critical.length === 1 ? "" : "e"} ·
              Kontrollmessung empfohlen
            </strong>
            <p>
              {critical
                .slice(0, 3)
                .map(
                  (item) =>
                    `${item.resident.name}: ${item.metric} ${formatVital(item.metric, item.value, item.secondary)} ${metricByKey(item.metric)?.unit}`,
                )
                .join(" · ")}
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => select(critical[0].resident.id, critical[0].metric)}
          >
            Verlauf ansehen <ModuleIcon name="chevron" className="button-icon" />
          </button>
        </section>
      )}
      {overview.error && <LoadError message={overview.error} onRetry={overview.reload} />}
      <div className="vitals-layout">
        <section className="card vitals-browser" aria-labelledby="vitals-list-title">
          <div className="vitals-toolbar">
            <div>
              <h2 className="card-title" id="vitals-list-title">
                Aktuelle Vitalwerte
              </h2>
              <p className="card-subtitle">
                {filtered.length} von {residents.length} {t.manyDative} · jeweils letzter Wert
              </p>
            </div>
            <label className="resident-search">
              <ModuleIcon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`${t.one}, Zimmer oder Bereich`}
                aria-label="Vitalwerte durchsuchen"
              />
            </label>
            <label className="vitals-unit-filter">
              <span>Wohnbereich</span>
              <CareSelect
                label="Wohnbereich"
                value={unit}
                options={["Gesamtes Haus", ...(overview.data?.careUnits ?? []).map((u) => u.name)]}
                onChange={setUnit}
              />
            </label>
            <div className="care-record-filters vitals-status-filters" aria-label="Vitalwertstatus filtern">
              {FILTERS.map((item) => (
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
          <div className="vitals-list">
            {filtered.map((resident) => (
              <button
                className={`vitals-row ${selected?.id === resident.id ? "selected" : ""}`}
                type="button"
                key={resident.id}
                onClick={() => select(resident.id)}
              >
                <span className="resident-avatar">{resident.initials}</span>
                <span className="vitals-person">
                  <strong>
                    {resident.name} <ResuscitationBadge residentId={resident.id} />
                  </strong>
                  <small>{[resident.room, resident.careUnit].filter(Boolean).join(" · ")}</small>
                  <em>{resident.lastMeasuredAt ? formatDateTime(resident.lastMeasuredAt) : "Noch keine Messung"}</em>
                </span>
                <span className="vitals-values">
                  {metrics.map((m) => {
                    const latest = resident.latest[m.key];
                    return (
                      <span key={m.key} className={latest ? `vital-value ${latest.status}` : "vital-value empty"}>
                        <small>{m.short}</small>
                        <strong>{latest ? formatVital(m.key, latest.value, latest.secondary) : "–"}</strong>
                        <em>{m.unit}</em>
                      </span>
                    );
                  })}
                </span>
                <span className={`status-badge ${resident.status ? statusTone[resident.status] : "info"}`}>
                  {resident.status ? statusLabels[resident.status] : "Keine Messung"}
                </span>
                <ModuleIcon name="chevron" />
              </button>
            ))}
            {!overview.loading && !filtered.length && (
              <EmptyState
                icon="search"
                title={`Keine ${t.many} gefunden`}
                text="Suchbegriff, Wohnbereich oder Statusfilter anpassen."
              />
            )}
            {overview.loading && !overview.data && <p className="list-hint">Vitalwerte werden geladen …</p>}
          </div>
        </section>

        {selected && (
          <aside className="vitals-detail" aria-live="polite">
            <section className="card vitals-detail-card">
              <div className="vitals-detail-head">
                <div className="care-profile-identity">
                  <span className="resident-avatar">{selected.initials}</span>
                  <div>
                    <p className="eyebrow">Ausgewählter {t.one}</p>
                    <h2>
                      {selected.name} <ResuscitationBadge residentId={selected.id} />
                    </h2>
                    <span>{[selected.room, selected.careUnit].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
                <span className={`status-badge ${selected.status ? statusTone[selected.status] : "info"}`}>
                  {selected.status ? statusLabels[selected.status] : "Keine Messung"}
                </span>
              </div>
              <ClinicalNote resident={selected} />
              <div className="vitals-detail-actions">
                {overview.data?.canRecord && (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setDialog({ residentId: selected.id })}
                  >
                    Neue Messung
                  </button>
                )}
                <Link className="secondary-button" href="/bewohner">
                  {t.prefix}akte
                </Link>
              </div>
            </section>

            <section className="card vitals-trend-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Messverlauf</p>
                  <h2 className="card-title">
                    {metric} · {days === 1 ? "24 Stunden" : `${days} Tage`}
                  </h2>
                </div>
                <div className="care-record-filters">
                  {[1, 7, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={days === d ? "active" : ""}
                      aria-pressed={days === d}
                      onClick={() => setDays(d)}
                    >
                      {d === 1 ? "24 h" : `${d} T`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="vitals-metric-tabs" aria-label="Messwert auswählen">
                {metrics.map((m) => (
                  <button
                    className={metric === m.key ? "active" : ""}
                    type="button"
                    key={m.key}
                    aria-pressed={metric === m.key}
                    onClick={() => setMetric(m.key)}
                  >
                    {m.short}
                  </button>
                ))}
              </div>
              {history.error && <LoadError message={history.error} onRetry={history.reload} />}
              {history.data ? (
                <TrendChart
                  measurements={history.data.measurements}
                  threshold={history.data.threshold}
                  unit={definition.unit}
                  label={metric}
                />
              ) : (
                <p className="list-hint">Verlauf wird geladen …</p>
              )}
              <MeasurementList measurements={history.data?.measurements ?? []} unit={definition.unit} />
            </section>

            <section className="card vitals-due-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Auffällige letzte Werte</p>
                  <h2 className="card-title">Kontrolle empfohlen</h2>
                </div>
              </div>
              <div>
                {abnormal.slice(0, 6).map((item) => (
                  <button
                    type="button"
                    key={`${item.resident.id}-${item.metric}`}
                    onClick={() => select(item.resident.id, item.metric)}
                  >
                    <time>{formatDateTime(item.measuredAt).replace(/^(Heute|Gestern), /, "")}</time>
                    <span>
                      <strong>{item.resident.name}</strong>
                      <small>
                        {item.metric} {formatVital(item.metric, item.value, item.secondary)} ·{" "}
                        {statusLabels[item.status]}
                      </small>
                    </span>
                    <ModuleIcon name="chevron" />
                  </button>
                ))}
                {!abnormal.length && <p className="list-hint">Alle zuletzt erfassten Werte liegen im Zielbereich.</p>}
              </div>
            </section>
          </aside>
        )}
      </div>
      {dialog && overview.data && (
        <MeasurementDialog
          residents={residents}
          initialResidentId={dialog.residentId}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            showToast(message);
            overview.reload();
            history.reload();
          }}
        />
      )}
    </>
  );
}
