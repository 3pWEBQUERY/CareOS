"use client";

import { useState } from "react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, timeInZurich, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import {
  VITAL_METRICS,
  evaluateVital,
  statusLabels,
  statusTone,
  type EffectiveThreshold,
  type VitalResident,
  type VitalStatus,
} from "@/lib/vitals-shared";
import { useCareResident, useTerms, useVitalMetrics } from "@/app/components/care-context";
import { sendOrQueue } from "@/app/components/offline-queue";

type Draft = Record<string, { value: string; secondary: string }>;
const parse = (value: string) => (value.trim() ? Number(value.replace(",", ".")) : null);

export default function MeasurementDialog({
  residents,
  initialResidentId,
  onClose,
  onSaved,
}: {
  residents: VitalResident[];
  initialResidentId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const metrics = useVitalMetrics();
  const t = useTerms();
  const [contextId] = useCareResident();
  const [residentId, setResidentId] = useState(
    initialResidentId ?? residents.find((r) => r.id === contextId)?.id ?? residents[0]?.id ?? "",
  );
  const [date, setDate] = useState(todayInZurich);
  const [time, setTime] = useState(() => timeInZurich());
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(VITAL_METRICS.map((m) => [m.key, { value: "", secondary: "" }])),
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Thresholds of the selected resident, for the live hint next to each value.
  const { data } = useApiData<{ thresholds: Record<string, EffectiveThreshold> }>(
    residentId ? `/api/vitals/residents/${residentId}?days=1` : null,
  );
  const resident = residents.find((item) => item.id === residentId);
  const labelOf = (item: VitalResident) => `${item.name}${item.room ? ` · ${item.room}` : ""}`;
  const set = (metric: string, field: "value" | "secondary", value: string) =>
    setDraft((current) => ({ ...current, [metric]: { ...current[metric], [field]: value } }));
  const hint = (metric: string): VitalStatus | null => {
    const value = parse(draft[metric].value);
    const threshold = data?.thresholds[metric];
    return value === null || Number.isNaN(value) || !threshold || threshold.source === "none"
      ? null
      : evaluateVital(value, threshold);
  };

  async function save() {
    const values: Record<string, { value: number; secondary?: number }> = {};
    for (const metric of metrics) {
      const value = parse(draft[metric.key].value);
      if (value === null) continue;
      if (Number.isNaN(value)) {
        setError(`${metric.key}: bitte eine Zahl eingeben.`);
        return;
      }
      const secondary = parse(draft[metric.key].secondary);
      values[metric.key] = metric.secondary ? { value, secondary: secondary ?? undefined } : { value };
    }
    setSaving(true);
    setError("");
    try {
      const result = await sendOrQueue<{ results: Array<{ metric: string; status: VitalStatus }> }>(
        "/api/vitals/measurements",
        { residentId, measuredAt: zurichTimeToIso(date, time), values, note },
        `Vitalwerte · ${resident?.name ?? t.one}`,
        { field: "note", label: "Bemerkung" },
      );
      if (result.queued) {
        onSaved(
          `${resident?.name}: Vitalwerte offline gespeichert – werden gesendet, sobald die Verbindung zurück ist`,
        );
        return;
      }
      const { results } = result.data;
      const abnormal = results.filter((r) => r.status !== "normal");
      onSaved(
        `${resident?.name}: ${results.length} Messwert${results.length === 1 ? "" : "e"} gespeichert` +
          (abnormal.length
            ? ` · auffällig: ${abnormal.map((r) => `${r.metric} (${statusLabels[r.status]})`).join(", ")}`
            : ""),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Messung konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="vital-measurement"
      eyebrow="Vitalwerte"
      title="Vitalwerte erfassen"
      description={`Nur ausgefüllte Felder werden gespeichert. Die Einstufung erfolgt anhand der Grenzwerte des ${t.oneGenitive}.`}
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Messung speichern"
    >
      <label className="area-editor-wide">
        <span>{t.one}</span>
        {initialResidentId ? (
          <input value={resident ? labelOf(resident) : ""} readOnly />
        ) : (
          <CareSelect
            label={t.one}
            value={resident ? labelOf(resident) : `${t.oneOblique} wählen`}
            options={residents.map(labelOf)}
            onChange={(value) => setResidentId(residents.find((item) => labelOf(item) === value)?.id ?? residentId)}
          />
        )}
      </label>
      <label>
        <span>Datum</span>
        <CareDatePicker label="Messdatum" value={date} onChange={setDate} />
      </label>
      <label>
        <span>Uhrzeit</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      </label>
      {metrics.map((metric) => {
        const status = hint(metric.key);
        return (
          <div className="form-field vital-input" key={metric.key}>
            <span>
              {metric.key} <small>({metric.unit})</small>
              {status && <em className={`status-badge ${statusTone[status]}`}>{statusLabels[status]}</em>}
            </span>
            <div>
              <input
                inputMode="decimal"
                aria-label={metric.secondary ? `${metric.key} systolisch` : metric.key}
                placeholder={metric.secondary ? "systolisch" : "Wert"}
                value={draft[metric.key].value}
                onChange={(e) => set(metric.key, "value", e.target.value)}
              />
              {metric.secondary && (
                <>
                  <b aria-hidden="true">/</b>
                  <input
                    inputMode="decimal"
                    aria-label={`${metric.key} diastolisch`}
                    placeholder="diastolisch"
                    value={draft[metric.key].secondary}
                    onChange={(e) => set(metric.key, "secondary", e.target.value)}
                  />
                </>
              )}
            </div>
          </div>
        );
      })}
      <label className="area-editor-wide">
        <span>Bemerkung</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`z. B. nach Mobilisation gemessen, ${t.one} klagt über Schwindel`}
        />
      </label>
    </EditorDialog>
  );
}
