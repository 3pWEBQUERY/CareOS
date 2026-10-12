"use client";

import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  ReasonDialog,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { formatRange, metricByKey, type ThresholdRow, formatDecimal } from "@/lib/vitals-shared";
import type { VitalsOverview } from "./overview-view";
import { useCareResident, useTerms, useVitalMetrics } from "@/app/components/care-context";

type ThresholdPayload = { house: ThresholdRow[]; personal: ThresholdRow[] };
type Editing = { scope: "organization" | "resident"; row: ThresholdRow | null };

const sourceLabel = {
  organization: "Haus-Grenzwert",
  default: "Voreinstellung",
  none: "Kein Grenzwert",
  resident: "Persönlich",
};
const sourceTone = { organization: "stable", default: "info", none: "attention", resident: "stable" };

function limits(row: ThresholdRow, unit: string) {
  const f = (n: number) => formatDecimal(n);
  const parts = [
    row.criticalLower !== null ? `unter ${f(row.criticalLower)}` : null,
    row.criticalUpper !== null ? `über ${f(row.criticalUpper)}` : null,
  ].filter(Boolean);
  return parts.length ? `Alarm ${parts.join(" / ")} ${unit}` : "Keine Alarmgrenzen";
}

export default function ThresholdsView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const thresholds = useApiData<ThresholdPayload>("/api/vitals/thresholds");
  const overview = useApiData<VitalsOverview>("/api/vitals/overview");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<ThresholdRow | null>(null);
  const canHouse = overview.data?.canManageHouse ?? false;
  const canPersonal = overview.data?.canManagePersonal ?? false;
  const house = thresholds.data?.house ?? [];
  const personal = thresholds.data?.personal ?? [];
  const done = (message: string) => {
    setEditing(null);
    setRemoving(null);
    showToast(message);
    thresholds.reload();
  };

  return (
    <>
      <PageHeading
        eyebrow="Vitalwerte"
        title="Grenzwerte"
        description="Zielbereiche und Alarmgrenzen für die automatische Einstufung jeder Messung."
        action={
          canPersonal
            ? { label: "Persönlicher Zielbereich", onClick: () => setEditing({ scope: "resident", row: null }) }
            : undefined
        }
      />
      {thresholds.error && <LoadError message={thresholds.error} onRetry={thresholds.reload} />}
      <div className="vitals-threshold-layout">
        <section className="card threshold-list-card">
          <div className="threshold-heading">
            <div>
              <p className="eyebrow">Sicherheitslogik</p>
              <h2 className="card-title">Hausweite Grenzwerte</h2>
              <p className="card-subtitle">
                Gelten für alle {t.many} ohne persönlichen Zielbereich. Voreinstellungen bitte durch die Pflegeleitung
                bestätigen.
              </p>
            </div>
          </div>
          <div className="threshold-list">
            {house.map((row) => {
              const unit = metricByKey(row.metric)?.unit ?? "";
              return (
                <article key={row.metric}>
                  <span className={`threshold-icon ${sourceTone[row.source]}`}>
                    <ModuleIcon name="vitals" />
                  </span>
                  <span>
                    <strong>{row.metric}</strong>
                    <small>
                      {sourceLabel[row.source]} · {limits(row, unit)}
                    </small>
                  </span>
                  <span className="threshold-value">
                    <strong>{row.source === "none" ? "–" : formatRange(row, unit)}</strong>
                    <small>Zielbereich</small>
                  </span>
                  {canHouse ? (
                    <span className="threshold-actions">
                      {row.source === "organization" && (
                        <button className="quiet-button" type="button" onClick={() => setRemoving(row)}>
                          Zurücksetzen
                        </button>
                      )}
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => setEditing({ scope: "organization", row })}
                      >
                        {row.source === "organization" ? "Bearbeiten" : "Festlegen"} <ModuleIcon name="chevron" />
                      </button>
                    </span>
                  ) : (
                    <span />
                  )}
                </article>
              );
            })}
            {thresholds.loading && !thresholds.data && <p className="list-hint">Grenzwerte werden geladen …</p>}
          </div>
        </section>
        <aside className="threshold-side">
          <section className="card threshold-summary-card">
            <p className="eyebrow">Status</p>
            <strong>{house.filter((row) => row.source === "organization").length}</strong>
            <span>von {house.length} Messwerten mit eigenem Haus-Grenzwert</span>
            <div>
              <i
                style={{
                  width: `${house.length ? (house.filter((r) => r.source === "organization").length / house.length) * 100 : 0}%`,
                }}
              />
            </div>
            <small>{personal.length} persönliche Zielbereiche aktiv</small>
          </section>
          <section className="card threshold-personal-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Persönliche Zielbereiche</p>
                <h2 className="card-title">{t.prefix}bezogen</h2>
              </div>
              <span className="status-badge info">{personal.length}</span>
            </div>
            <ul className="threshold-personal-list">
              {personal.map((row) => (
                <li key={row.id}>
                  <span>
                    <strong>
                      {row.residentName} · {row.metric}
                    </strong>
                    <small>
                      {formatRange(row, metricByKey(row.metric)?.unit ?? "")}
                      {row.reason ? ` · ${row.reason}` : ""}
                    </small>
                  </span>
                  {canPersonal && (
                    <span className="threshold-actions">
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => setEditing({ scope: "resident", row })}
                      >
                        Bearbeiten
                      </button>
                      <button className="quiet-button" type="button" onClick={() => setRemoving(row)}>
                        Entfernen
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {!thresholds.loading && !personal.length && (
              <EmptyState
                title="Keine persönlichen Zielbereiche"
                text={`Alle ${t.many} werden mit den Haus-Grenzwerten bewertet.`}
                icon="vitals"
              />
            )}
          </section>
        </aside>
      </div>
      {editing && (
        <ThresholdDialog
          editing={editing}
          residents={(overview.data?.residents ?? []).map((r) => ({ id: r.id, name: r.name }))}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      )}
      {removing && (
        <ReasonDialog
          eyebrow="Vitalwerte"
          title={removing.residentId ? "Persönlichen Zielbereich entfernen" : "Haus-Grenzwert zurücksetzen"}
          description={
            removing.residentId
              ? `${removing.residentName} · ${removing.metric}: Danach gilt wieder der Haus-Grenzwert.`
              : `${removing.metric}: Danach gilt wieder die Voreinstellung.`
          }
          label="Grund"
          placeholder="z. B. Zielbereich laut Visite nicht mehr erforderlich"
          submitLabel={removing.residentId ? "Entfernen" : "Zurücksetzen"}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/vitals/thresholds/${removing.id}`, { method: "DELETE", body: { reason } });
            done(`${removing.metric}: Grenzwert ${removing.residentId ? "entfernt" : "zurückgesetzt"}`);
          }}
        />
      )}
    </>
  );
}

function ThresholdDialog({
  editing,
  residents,
  onClose,
  onSaved,
}: {
  editing: Editing;
  residents: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const metrics = useVitalMetrics();
  const t = useTerms();
  const row = editing.row;
  const [metric, setMetric] = useState(row?.metric ?? metrics[0].key);
  const [contextId] = useCareResident();
  const [residentId, setResidentId] = useState(
    row?.residentId ?? residents.find((r) => r.id === contextId)?.id ?? residents[0]?.id ?? "",
  );
  const show = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
  const [values, setValues] = useState({
    targetLower: show(row?.targetLower),
    targetUpper: show(row?.targetUpper),
    criticalLower: show(row?.criticalLower),
    criticalUpper: show(row?.criticalUpper),
  });
  const [reason, setReason] = useState(row?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const unit = metricByKey(metric)?.unit ?? "";
  const personal = editing.scope === "resident";
  const toNumber = (value: string) => (value.trim() ? Number(value.replace(",", ".")) : null);
  const field = (key: keyof typeof values, label: string) => (
    <label>
      <span>
        {label} ({unit})
      </span>
      <input
        inputMode="decimal"
        value={values[key]}
        onChange={(e) => setValues((c) => ({ ...c, [key]: e.target.value }))}
        placeholder="leer = keine Grenze"
      />
    </label>
  );

  async function save() {
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/vitals/thresholds", {
        method: "POST",
        body: {
          metric,
          residentId: personal ? residentId : null,
          targetLower: toNumber(values.targetLower),
          targetUpper: toNumber(values.targetUpper),
          criticalLower: toNumber(values.criticalLower),
          criticalUpper: toNumber(values.criticalUpper),
          reason,
        },
      });
      onSaved(`${metric}: ${personal ? "persönlicher Zielbereich" : "Haus-Grenzwert"} gespeichert`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Grenzwert konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="vital-threshold"
      eyebrow="Vitalwerte · Grenzwerte"
      title={personal ? "Persönlicher Zielbereich" : "Haus-Grenzwert festlegen"}
      description="Ausserhalb des Zielbereichs wird eine Messung als „Beobachten“ eingestuft, ausserhalb der Alarmgrenzen als „Kritisch“. Der bisherige Wert bleibt als Verlauf erhalten."
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Grenzwert speichern"
    >
      {personal && (
        <label className="area-editor-wide">
          <span>{t.one}</span>
          {row ? (
            <input value={row.residentName ?? ""} readOnly />
          ) : (
            <CareSelect
              label={t.one}
              value={residents.find((r) => r.id === residentId)?.name ?? `${t.oneOblique} wählen`}
              options={residents.map((r) => r.name)}
              onChange={(value) => setResidentId(residents.find((r) => r.name === value)?.id ?? residentId)}
            />
          )}
        </label>
      )}
      <label className="area-editor-wide">
        <span>Messwert</span>
        {row ? (
          <input value={metric} readOnly />
        ) : (
          <CareSelect label="Messwert" value={metric} options={metrics.map((m) => m.key)} onChange={setMetric} />
        )}
      </label>
      {field("targetLower", "Zielbereich ab")}
      {field("targetUpper", "Zielbereich bis")}
      {field("criticalLower", "Alarm unter")}
      {field("criticalUpper", "Alarm über")}
      <label className="area-editor-wide">
        <span>{personal ? "Begründung / ärztliche Anordnung" : "Begründung (optional)"}</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            personal ? "z. B. Zielbereich laut Visite Dr. Weber vom 25.09." : "z. B. Beschluss Qualitätszirkel"
          }
        />
      </label>
    </EditorDialog>
  );
}
