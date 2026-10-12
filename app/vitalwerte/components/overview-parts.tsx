"use client";

import { useTerms } from "@/app/components/care-context";
import { ModuleIcon } from "@/app/components/module-icon";
import { formatDateTime } from "@/app/components/workspace-ui";
import {
  formatVital,
  metricByKey,
  statusLabels,
  statusTone,
  type EffectiveThreshold,
  type VitalMeasurement,
  type VitalResident,
  type VitalStatus,
} from "@/lib/vitals-shared";

export type History = { measurements: VitalMeasurement[]; threshold: EffectiveThreshold };

export const FILTERS = ["Alle", "Kritisch", "Beobachten", "Im Zielbereich", "Ohne Messung"] as const;

export const WEEK = 7 * 86_400_000;

export function ClinicalNote({ resident }: { resident: VitalResident }) {
  const t = useTerms();
  const entries = Object.entries(resident.latest).filter(([, v]) => v.status !== "normal");
  const tone: VitalStatus | null = resident.status;
  return (
    <div className={`vitals-clinical-note ${tone ? statusTone[tone] : "attention"}`}>
      <ModuleIcon name={tone === "normal" ? "check" : "alert"} />
      <p>
        <strong>Klinische Einordnung</strong>
        <span>
          {!tone
            ? `Für diesen ${t.oneOblique} ist noch keine Messung erfasst.`
            : entries.length
              ? entries
                  .map(
                    ([metric, v]) =>
                      `${metric} ${formatVital(metric, v.value, v.secondary)} ${metricByKey(metric)?.unit} (${statusLabels[v.status]}, ${formatDateTime(v.measuredAt)})`,
                  )
                  .join(" · ")
              : "Alle zuletzt erfassten Werte liegen im Zielbereich."}
        </span>
      </p>
    </div>
  );
}

export function MeasurementList({ measurements, unit }: { measurements: VitalMeasurement[]; unit: string }) {
  if (!measurements.length) return null;
  return (
    <ul className="vital-measurement-list">
      {[...measurements]
        .reverse()
        .slice(0, 5)
        .map((m) => (
          <li key={m.id}>
            <span className={`status-dot ${m.status}`} aria-hidden="true" />
            <strong>
              {formatVital(m.metric, m.value, m.secondary)} {unit}
            </strong>
            <small>
              {formatDateTime(m.measuredAt)} · {m.measuredBy ?? "unbekannt"}
              {m.note ? ` · ${m.note}` : ""}
            </small>
          </li>
        ))}
    </ul>
  );
}
