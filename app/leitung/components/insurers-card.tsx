"use client";

import { useState } from "react";
import { EditorDialog, requestJson, useApiData } from "@/app/components/workspace-ui";
import { COUNTRIES } from "@/lib/country";
import { INSURERS_MAX, type InsurerList } from "@/lib/insurers-shared";

// Versicherungen zur Auswahl in der Akte (Stammdaten › Versicherung): Vorgabe für das Land der Einrichtung,
// von der Administration ergänzt, gekürzt oder umbenannt; die Vorgabe lässt sich wiederherstellen.
export function InsurersCard({ showToast }: { showToast: (message: string) => void }) {
  const data = useApiData<InsurerList>("/api/admin/insurers");
  const [draft, setDraft] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const list = data.data;
  const countryName = list ? COUNTRIES[list.country].name : "";

  async function save(insurers: string[] | null, message: string) {
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/admin/insurers", { method: "PUT", body: { insurers } });
      setDraft(null);
      setResetting(false);
      data.reload();
      showToast(message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card admin-terminology-card admin-retention-card" aria-labelledby="insurers-card-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Stammdaten</p>
          <h2 className="card-title" id="insurers-card-title">
            Versicherungen
          </h2>
          <p className="card-subtitle">
            {list
              ? `${list.insurers.length} Versicherungen für ${countryName} · ${list.custom ? "eigene Liste" : "Vorgabe"} · in der Akte unter Stammdaten › Versicherung`
              : "Wird geladen …"}
          </p>
        </div>
        <div className="admin-insurers-actions">
          {list?.custom && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setError("");
                setResetting(true);
              }}
            >
              Vorgabe wiederherstellen
            </button>
          )}
          <button
            className="secondary-button"
            type="button"
            disabled={!list}
            onClick={() => {
              setError("");
              setDraft(list?.insurers.join("\n") ?? "");
            }}
          >
            Bearbeiten
          </button>
        </div>
      </div>
      <div className="admin-retention-list admin-insurers-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {list?.insurers.map((item) => (
          <div className="admin-retention-row" key={item}>
            <span>
              <strong>{item}</strong>
            </span>
          </div>
        ))}
      </div>
      {draft !== null && (
        <EditorDialog
          id="insurers"
          eyebrow="Konfiguration · Stammdaten"
          title={`Versicherungen für ${countryName}`}
          description={`Eine Versicherung pro Zeile, höchstens ${INSURERS_MAX}. Bereits in Akten erfasste Versicherungen bleiben erhalten.`}
          onClose={() => setDraft(null)}
          onSubmit={() =>
            save(
              draft.split("\n").filter((item) => item.trim()),
              "Versicherungen gespeichert",
            )
          }
          saving={saving}
          error={error}
          submitLabel="Versicherungen speichern"
        >
          <label className="area-editor-wide">
            <span>Versicherungen</span>
            <textarea rows={14} value={draft} onChange={(event) => setDraft(event.target.value)} />
          </label>
        </EditorDialog>
      )}
      {resetting && (
        <EditorDialog
          id="insurers-reset"
          eyebrow="Konfiguration · Stammdaten"
          title="Vorgabe wiederherstellen"
          description={`Die eigene Liste für ${countryName} wird durch die Vorgabe ersetzt. Bereits in Akten erfasste Versicherungen bleiben erhalten.`}
          onClose={() => setResetting(false)}
          onSubmit={() => save(null, "Vorgabe der Versicherungen wiederhergestellt")}
          saving={saving}
          error={error}
          submitLabel="Wiederherstellen"
        >
          {null}
        </EditorDialog>
      )}
    </section>
  );
}
