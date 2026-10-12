"use client";

import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import { LoadError, PageHeading, formatDateTime, useApiData } from "@/app/components/workspace-ui";
import {
  VITAL_METRICS,
  formatRange,
  formatVital,
  metricByKey,
  statusLabels,
  statusTone,
  type EffectiveThreshold,
  type VitalMeasurement,
} from "@/lib/vitals-shared";
import { abnormalValues, type VitalsOverview } from "./overview-view";
import TrendChart from "./trend-chart";
import { useCareResident, useHeaderResident, useTerms, useVitalMetrics } from "@/app/components/care-context";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

type History = { measurements: VitalMeasurement[]; threshold: EffectiveThreshold };
const RANGES = [
  { days: 7, label: "7 Tage" },
  { days: 30, label: "30 Tage" },
  { days: 90, label: "90 Tage" },
];
const sourceLabel = {
  resident: "persönlicher Zielbereich",
  organization: "Haus-Grenzwert",
  default: "Voreinstellung",
  none: "kein Grenzwert",
};

export default function DevelopmentView() {
  const metrics = useVitalMetrics();
  const t = useTerms();
  const overview = useApiData<VitalsOverview>("/api/vitals/overview");
  const residents = overview.data?.residents ?? [];
  const [, setResidentId] = useCareResident();
  const [chosenMetric, setMetric] = useState(VITAL_METRICS[0].key);
  const metric = metrics.some((m) => m.key === chosenMetric) ? chosenMetric : metrics[0].key;
  const [days, setDays] = useState(30);
  const { resident, missing } = useHeaderResident(residents, overview.loading);
  const history = useApiData<History>(
    resident ? `/api/vitals/residents/${resident.id}?metric=${encodeURIComponent(metric)}&days=${days}` : null,
  );
  const definition = metricByKey(metric)!;
  const measurements = history.data?.measurements ?? [];
  const values = measurements.map((m) => m.value);
  const inTarget = measurements.filter((m) => m.status === "normal").length;
  const fmt = (v: number) => formatVital(metric, v, null);

  return (
    <>
      <PageHeading
        eyebrow="Vitalwerte"
        title="Entwicklung"
        description="Trends und Veränderungen der Vitalwerte im Zeitverlauf erkennen."
      />
      {overview.error && <LoadError message={overview.error} onRetry={overview.reload} />}
      <div className="vitals-development-layout">
        <section className="card development-chart-card">
          <div className="development-heading">
            <div>
              <p className="eyebrow">Verlauf</p>
              <h2 className="card-title">{resident ? `${metric} · ${resident.name}` : "Entwicklung der Vitalwerte"}</h2>
              <p className="card-subtitle">
                {history.data
                  ? `Bewertet mit ${sourceLabel[history.data.threshold.source]} (${formatRange(history.data.threshold, definition.unit)})`
                  : `Messwerte je ${t.one} im Zeitverlauf.`}
              </p>
            </div>
          </div>
          <div className="development-controls">
            <CareSelect
              label="Messwert auswählen"
              value={metric}
              options={metrics.map((m) => m.key)}
              onChange={setMetric}
            />
            <div>
              {RANGES.map((range) => (
                <button
                  key={range.days}
                  className={days === range.days ? "active" : ""}
                  type="button"
                  aria-pressed={days === range.days}
                  onClick={() => setDays(range.days)}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          {history.error && <LoadError message={history.error} onRetry={history.reload} />}
          {resident && history.data && (
            <TrendChart
              measurements={measurements}
              threshold={history.data.threshold}
              unit={definition.unit}
              label={metric}
            />
          )}
          {!resident && <HeaderResidentHint loading={overview.loading} missing={missing} />}
          {measurements.length > 0 && (
            <div className="vital-stats">
              <span>
                <small>Messungen</small>
                <strong>{measurements.length}</strong>
              </span>
              <span>
                <small>Minimum</small>
                <strong>
                  {fmt(Math.min(...values))} {definition.unit}
                </strong>
              </span>
              <span>
                <small>Maximum</small>
                <strong>
                  {fmt(Math.max(...values))} {definition.unit}
                </strong>
              </span>
              <span>
                <small>Durchschnitt</small>
                <strong>
                  {fmt(values.reduce((a, b) => a + b, 0) / values.length)} {definition.unit}
                </strong>
              </span>
              <span>
                <small>Im Zielbereich</small>
                <strong>{Math.round((inTarget / measurements.length) * 100)} %</strong>
              </span>
            </div>
          )}
        </section>
        <aside className="development-side">
          <section className="card development-insight-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Klinische Einordnung</p>
                <h2 className="card-title">Werte mit Aufmerksamkeit</h2>
              </div>
              <span className="status-badge attention">
                {abnormalValues(residents).length} {abnormalValues(residents).length === 1 ? "Hinweis" : "Hinweise"}
              </span>
            </div>
            {abnormalValues(residents)
              .slice(0, 8)
              .map((item) => (
                <button
                  type="button"
                  key={`${item.resident.id}-${item.metric}`}
                  onClick={() => {
                    setResidentId(item.resident.id);
                    setMetric(item.metric);
                  }}
                >
                  <span className={`resident-avatar ${statusTone[item.status]}`}>{item.resident.initials}</span>
                  <span>
                    <strong>
                      {item.resident.name} <ResuscitationBadge residentId={item.resident.id} />
                    </strong>
                    <small>
                      {item.metric} {formatVital(item.metric, item.value, item.secondary)} · {statusLabels[item.status]}{" "}
                      · {formatDateTime(item.measuredAt)}
                    </small>
                  </span>
                  <ModuleIcon name="chevron" />
                </button>
              ))}
            {!overview.loading && !abnormalValues(residents).length && (
              <p className="list-hint">Alle zuletzt erfassten Werte liegen im Zielbereich.</p>
            )}
          </section>
          <section className="card development-note-card">
            <ModuleIcon name="vitals" />
            <strong>Persönliche Verläufe</strong>
            <p>
              Jede Messung wird zum Messzeitpunkt mit dem gültigen Grenzwert bewertet: persönlicher Zielbereich vor
              Haus-Grenzwert vor Voreinstellung.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
