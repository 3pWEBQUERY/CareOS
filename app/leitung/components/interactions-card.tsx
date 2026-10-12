"use client";

import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, formatDateTime, requestJson, useApiData } from "@/app/components/workspace-ui";
import {
  INTERACTION_SEVERITIES,
  INTERACTION_SEVERITY_KEYS,
  type InteractionRule,
  type InteractionSeverity,
  type InteractionStatus,
} from "@/lib/medication-interactions-shared";

type Draft = Omit<InteractionRule, "id" | "updatedAt" | "updatedBy"> & { id: string | null };

const emptyDraft = (): Draft => ({
  id: null,
  substanceA: "",
  substanceB: "",
  severity: "moderate",
  description: "",
  recommendation: "",
  source: "",
});

// Wechselwirkungen: Hinweise der Einrichtung (z. B. von der Apotheke) mit Quelle. Eine lizenzierte
// Arzneimitteldatenbank wird nicht angebunden (kein Medizinprodukt); CareOS enthält keine eigenen Regeln.
export function InteractionsCard({ showToast }: { showToast: (message: string) => void }) {
  const data = useApiData<{ rules: InteractionRule[]; status: InteractionStatus }>("/api/medication/interactions");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<InteractionRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const rules = data.data?.rules ?? [];

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/medication/interactions", { method: draft.id ? "PATCH" : "POST", body: draft });
      setDraft(null);
      data.reload();
      showToast(draft.id ? "Hinweis gespeichert" : "Hinweis erfasst");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card admin-terminology-card admin-interactions-card" aria-labelledby="admin-interactions-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Medikation</p>
          <h2 className="card-title" id="admin-interactions-title">
            Wechselwirkungen
          </h2>
          <p className="card-subtitle">
            Hinweise der Einrichtung mit Quelle · Lizenzierte Arzneimitteldatenbank: nicht angebunden
          </p>
        </div>
        {rules.length > 0 && <span className="status-badge">{rules.length}</span>}
      </div>
      <div className="admin-retention-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {rules.map((rule) => (
          <div className="admin-retention-row" key={rule.id}>
            <span>
              <strong>
                {rule.substanceA} + {rule.substanceB} <small>{INTERACTION_SEVERITIES[rule.severity]}</small>
              </strong>
              <small>{rule.description}</small>
              <small>
                Quelle: {rule.source} · {rule.updatedBy ? `${rule.updatedBy}, ` : ""}
                {formatDateTime(rule.updatedAt)}
              </small>
            </span>
            <div className="admin-webhook-actions">
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  setDraft({ ...rule });
                  setError("");
                }}
              >
                Bearbeiten
              </button>
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  setRemoving(rule);
                  setError("");
                }}
              >
                Entfernen
              </button>
            </div>
          </div>
        ))}
        {data.data && !rules.length && (
          <p className="list-hint">
            Noch keine Hinweise erfasst. Geprüft werden die laufenden Verordnungen gegen diese Hinweise; ohne Hinweise
            findet keine Prüfung statt.
          </p>
        )}
      </div>
      <div className="admin-branding-body">
        <button
          className="secondary-button"
          type="button"
          disabled={!data.data}
          onClick={() => {
            setDraft(emptyDraft());
            setError("");
          }}
        >
          Hinweis erfassen
        </button>
      </div>
      {draft && (
        <EditorDialog
          id="interaction-editor"
          eyebrow="Medikation · Wechselwirkungen"
          title={draft.id ? "Hinweis bearbeiten" : "Hinweis erfassen"}
          description="Wirkstoff oder Präparat, wie es in den Verordnungen steht. Der Hinweis erscheint im Medikamentenplan, sobald beide in laufenden Verordnungen derselben Person vorkommen."
          onClose={() => setDraft(null)}
          onSubmit={save}
          saving={saving}
          error={error}
          submitLabel="Speichern"
        >
          <label>
            <span>Wirkstoff / Präparat A</span>
            <input
              value={draft.substanceA}
              maxLength={120}
              onChange={(event) => setDraft({ ...draft, substanceA: event.target.value })}
              required
            />
          </label>
          <label>
            <span>Wirkstoff / Präparat B</span>
            <input
              value={draft.substanceB}
              maxLength={120}
              onChange={(event) => setDraft({ ...draft, substanceB: event.target.value })}
              required
            />
          </label>
          <label>
            <span>Schweregrad</span>
            <CareSelect
              label="Schweregrad"
              value={INTERACTION_SEVERITIES[draft.severity]}
              options={INTERACTION_SEVERITY_KEYS.map((key) => INTERACTION_SEVERITIES[key])}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  severity:
                    INTERACTION_SEVERITY_KEYS.find((key) => INTERACTION_SEVERITIES[key] === value) ??
                    (draft.severity as InteractionSeverity),
                })
              }
            />
          </label>
          <label>
            <span>Quelle</span>
            <input
              value={draft.source}
              maxLength={240}
              onChange={(event) => setDraft({ ...draft, source: event.target.value })}
              placeholder="z. B. Apotheke, Fachinformation, Datum"
              required
            />
          </label>
          <label className="area-editor-wide">
            <span>Wechselwirkung</span>
            <textarea
              value={draft.description}
              maxLength={2000}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              required
            />
          </label>
          <label className="area-editor-wide">
            <span>Empfehlung</span>
            <textarea
              value={draft.recommendation}
              maxLength={2000}
              onChange={(event) => setDraft({ ...draft, recommendation: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}
      {removing && (
        <EditorDialog
          id="interaction-remove"
          eyebrow="Medikation · Wechselwirkungen"
          title={`${removing.substanceA} + ${removing.substanceB} entfernen`}
          description="Der Hinweis erscheint danach nicht mehr im Medikamentenplan."
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson("/api/medication/interactions", { method: "DELETE", body: { id: removing.id } });
              setRemoving(null);
              data.reload();
              showToast("Hinweis entfernt");
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Entfernen"
          danger
        >
          <p className="area-editor-wide">{removing.description}</p>
        </EditorDialog>
      )}
    </section>
  );
}
