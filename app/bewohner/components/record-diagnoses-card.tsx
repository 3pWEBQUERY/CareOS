"use client";

import { useState } from "react";
import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import { EditorDialog, formatDate, requestJson, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import {
  DIAGNOSIS_KINDS,
  DIAGNOSIS_STATUSES,
  type Diagnosis,
  type DiagnosisKind,
  type DiagnosisList,
  type DiagnosisStatus,
} from "@/lib/diagnoses-shared";

type Draft = {
  id: string | null;
  label: string;
  icdCode: string;
  kind: DiagnosisKind;
  sinceOn: string;
  source: string;
  status: DiagnosisStatus;
  resolvedOn: string;
  note: string;
  updatedAt: string | null;
};

const EMPTY: Draft = {
  id: null,
  label: "",
  icdCode: "",
  kind: "secondary",
  sinceOn: "",
  source: "",
  status: "current",
  resolvedOn: "",
  note: "",
  updatedAt: null,
};

// Diagnosen der Person, wie von Ärztin/Arzt gestellt (Quelle angeben). Überholte Diagnosen werden abgeschlossen,
// Fehleinträge mit Begründung entfernt.
export function RecordDiagnosesCard({
  residentId,
  residentName,
  onAction,
}: {
  residentId: string;
  residentName: string;
  onAction: (message: string) => void;
}) {
  const list = useApiData<DiagnosisList>(`/api/residents/${residentId}/diagnoses`);
  const data = list.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Diagnosis | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = data?.diagnoses.filter((item) => item.status === "current") ?? [];
  const resolved = data?.diagnoses.filter((item) => item.status === "resolved") ?? [];

  async function run(action: () => Promise<unknown>, message: string) {
    setSaving(true);
    setError("");
    try {
      await action();
      list.reload();
      onAction(message);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const row = (item: Diagnosis) => (
    <li key={item.id} className={item.status === "resolved" ? "resolved" : ""}>
      <div>
        <strong>
          {item.label}
          {item.icdCode && <span className="diagnosis-code">{item.icdCode}</span>}
        </strong>
        <small>
          {[
            DIAGNOSIS_KINDS[item.kind],
            item.sinceOn && `seit ${formatDate(item.sinceOn)}`,
            item.status === "resolved" &&
              (item.resolvedOn ? `abgeschlossen am ${formatDate(item.resolvedOn)}` : "abgeschlossen"),
            item.source && `Quelle: ${item.source}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
        {item.note && <small>{item.note}</small>}
      </div>
      {data?.canWrite && (
        <span className="diagnosis-actions">
          <button
            type="button"
            className="death-checklist-action"
            aria-label={`${item.label} bearbeiten`}
            onClick={() => {
              setError("");
              setDraft({
                id: item.id,
                label: item.label,
                icdCode: item.icdCode,
                kind: item.kind,
                sinceOn: item.sinceOn ?? "",
                source: item.source,
                status: item.status,
                resolvedOn: item.resolvedOn ?? "",
                note: item.note,
                updatedAt: item.updatedAt,
              });
            }}
          >
            <PencilSimple aria-hidden="true" />
          </button>
          <button
            type="button"
            className="death-checklist-action"
            aria-label={`${item.label} entfernen`}
            onClick={() => {
              setError("");
              setReason("");
              setRemoving(item);
            }}
          >
            <Trash aria-hidden="true" />
          </button>
        </span>
      )}
    </li>
  );

  return (
    <section className="record-card master-data-card" aria-labelledby="diagnoses-title">
      <div className="record-card-heading">
        <div>
          <span className="record-section-label">Medizin</span>
          <h3 id="diagnoses-title">Diagnosen</h3>
        </div>
        {data?.canWrite && (
          <button
            type="button"
            aria-label="Diagnose erfassen"
            onClick={() => {
              setError("");
              setDraft({ ...EMPTY, kind: current.some((item) => item.kind === "main") ? "secondary" : "main" });
            }}
          >
            <Plus aria-hidden="true" /> Erfassen
          </button>
        )}
      </div>
      <div className="master-data-form-grid single-column">
        {list.error && !data ? (
          <p className="restraints-error" role="alert">
            {list.error}
          </p>
        ) : !data ? (
          <p className="record-export-note">Wird geladen …</p>
        ) : !data.diagnoses.length ? (
          <p className="record-export-note">
            Noch keine Diagnosen erfasst – z. B. aus dem Arztbericht oder der ärztlichen Verordnung übernehmen.
          </p>
        ) : (
          <>
            {current.length > 0 && (
              <ul className="death-checklist diagnosis-list" aria-label="Aktuelle Diagnosen">
                {current.map(row)}
              </ul>
            )}
            {resolved.length > 0 && (
              <details className="diagnosis-resolved">
                <summary>Abgeschlossene Diagnosen ({resolved.length})</summary>
                <ul className="death-checklist diagnosis-list" aria-label="Abgeschlossene Diagnosen">
                  {resolved.map(row)}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      {draft && (
        <EditorDialog
          id="diagnosis"
          eyebrow={`${residentName} · Diagnosen`}
          title={draft.id ? "Diagnose bearbeiten" : "Diagnose erfassen"}
          description="Wie von Ärztin bzw. Arzt gestellt, mit Quelle. Der ICD-10-Code ist freiwillig."
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            const body = { ...draft, resolvedOn: draft.status === "resolved" ? draft.resolvedOn : "" };
            const saved = await run(
              () =>
                draft.id
                  ? requestJson(`/api/diagnoses/${draft.id}`, { method: "PATCH", body })
                  : requestJson(`/api/residents/${residentId}/diagnoses`, { method: "POST", body }),
              draft.id ? "Diagnose gespeichert" : "Diagnose erfasst",
            );
            if (saved) setDraft(null);
          }}
          saving={saving}
          error={error}
          submitLabel="Diagnose speichern"
        >
          <label className="area-editor-wide">
            <span>Diagnose</span>
            <input
              required
              maxLength={200}
              placeholder="Bezeichnung wie im Arztbericht"
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </label>
          <label>
            <span>ICD-10-Code (freiwillig)</span>
            <input
              maxLength={12}
              placeholder="z. B. I63.5"
              value={draft.icdCode}
              onChange={(event) => setDraft({ ...draft, icdCode: event.target.value })}
            />
          </label>
          <label>
            <span>Art</span>
            <CareOptionSelect
              label="Art"
              value={draft.kind}
              onChange={(value) => setDraft({ ...draft, kind: value as DiagnosisKind })}
              options={Object.entries(DIAGNOSIS_KINDS).map(([value, label]) => ({ value, label }))}
            />
          </label>
          <label>
            <span>Seit</span>
            <CareDatePicker
              clearable
              label="Seit"
              value={draft.sinceOn}
              max={todayInZurich()}
              onChange={(value) => setDraft({ ...draft, sinceOn: value })}
            />
          </label>
          <label>
            <span>Quelle</span>
            <input
              maxLength={200}
              placeholder="z. B. Austrittsbericht Spital, März 2026"
              value={draft.source}
              onChange={(event) => setDraft({ ...draft, source: event.target.value })}
            />
          </label>
          <label>
            <span>Status</span>
            <CareOptionSelect
              label="Status"
              value={draft.status}
              onChange={(value) => setDraft({ ...draft, status: value as DiagnosisStatus })}
              options={Object.entries(DIAGNOSIS_STATUSES).map(([value, label]) => ({ value, label }))}
            />
          </label>
          {draft.status === "resolved" && (
            <label>
              <span>Abgeschlossen am</span>
              <CareDatePicker
                clearable
                label="Abgeschlossen am"
                value={draft.resolvedOn}
                max={todayInZurich()}
                onChange={(value) => setDraft({ ...draft, resolvedOn: value })}
              />
            </label>
          )}
          <label className="area-editor-wide">
            <span>Bemerkung</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {removing && (
        <EditorDialog
          id="diagnosis-remove"
          eyebrow={`${residentName} · Diagnosen`}
          title="Diagnose entfernen"
          description={`„${removing.label}“ wird entfernt. Nur für Fehleinträge (z. B. falsche Person, doppelt erfasst); eine überholte Diagnose bitte abschliessen. Steht im Protokoll der Akte.`}
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            if (!reason.trim()) return setError("Bitte angeben, warum der Eintrag entfernt wird.");
            const done = await run(
              () => requestJson(`/api/diagnoses/${removing.id}`, { method: "DELETE", body: { reason } }),
              "Diagnose entfernt",
            );
            if (done) setRemoving(null);
          }}
          saving={saving}
          error={error}
          submitLabel="Entfernen"
          danger
        >
          <label className="area-editor-wide">
            <span>Grund</span>
            <input
              required
              maxLength={500}
              placeholder="z. B. bei der falschen Person erfasst"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </EditorDialog>
      )}
    </section>
  );
}
