"use client";

import { useState } from "react";
import { EditorDialog, formatDateTime, requestJson, useApiData } from "@/app/components/workspace-ui";
import { API_SCOPES, API_SCOPE_KEYS, type ApiKeySummary, type ApiScope } from "@/lib/api-keys-shared";

// Öffentliche Schnittstelle (FHIR R4, nur lesend): Schlüssel erstellen und widerrufen. Der Schlüssel erscheint nur
// einmal direkt nach dem Erstellen.
export function ApiKeysCard({ showToast }: { showToast: (message: string) => void }) {
  const data = useApiData<{ keys: ApiKeySummary[] }>("/api/admin/api-keys");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const keys = data.data?.keys ?? [];
  const active = keys.filter((key) => !key.revokedAt);

  const open = () => {
    setCreating(true);
    setName("");
    setScopes([]);
    setError("");
  };

  return (
    <section className="card admin-terminology-card admin-api-card" aria-labelledby="admin-api-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Schnittstelle</p>
          <h2 className="card-title" id="admin-api-title">
            FHIR-Schlüssel
          </h2>
          <p className="card-subtitle">HL7 FHIR R4, nur lesend · /api/fhir/r4 · jeder Zugriff wird protokolliert</p>
        </div>
        {active.length > 0 && <span className="status-badge">{active.length}</span>}
      </div>
      <div className="admin-retention-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {keys.map((key) => (
          <div className="admin-retention-row" key={key.id}>
            <span>
              <strong>
                {key.name} <small>{key.prefix}…</small>
              </strong>
              <small>
                {key.scopes.map((scope) => API_SCOPES[scope]).join(", ")} ·{" "}
                {key.revokedAt
                  ? `widerrufen ${formatDateTime(key.revokedAt)}`
                  : key.lastUsedAt
                    ? `zuletzt genutzt ${formatDateTime(key.lastUsedAt)}`
                    : "noch nicht genutzt"}
              </small>
            </span>
            {!key.revokedAt && (
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  setRevoking(key);
                  setError("");
                }}
              >
                Widerrufen
              </button>
            )}
          </div>
        ))}
        {data.data && !keys.length && <p className="list-hint">Noch kein Schlüssel erstellt.</p>}
      </div>
      <div className="admin-branding-body">
        <button className="secondary-button" type="button" disabled={!data.data} onClick={open}>
          Schlüssel erstellen
        </button>
      </div>
      {creating && !created && (
        <EditorDialog
          id="api-key-create"
          eyebrow="Schnittstelle · FHIR"
          title="Schlüssel erstellen"
          description="Für ein angebundenes System (z. B. Spital, Arztpraxis, Auswertung). Der Schlüssel wird nur einmal angezeigt; gespeichert wird er nicht."
          onClose={() => setCreating(false)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              const result = await requestJson<{ key: string }>("/api/admin/api-keys", {
                method: "POST",
                body: { name, scopes },
              });
              setCreated({ name, key: result.key });
              data.reload();
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Erstellen"
        >
          <label className="area-editor-wide">
            <span>Name</span>
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Hausarztpraxis Dorf"
              required
            />
          </label>
          <fieldset className="area-editor-wide">
            <legend>Berechtigungen (nur lesen)</legend>
            <div className="area-service-options">
              {API_SCOPE_KEYS.map((scope) => (
                <label key={scope}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() =>
                      setScopes((current) =>
                        current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
                      )
                    }
                  />
                  <span>{API_SCOPES[scope]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </EditorDialog>
      )}
      {created && (
        <EditorDialog
          id="api-key-created"
          eyebrow="Schnittstelle · FHIR"
          title={`Schlüssel „${created.name}“`}
          description="Jetzt kopieren und sicher an das angebundene System übergeben. Er wird nicht noch einmal angezeigt."
          onClose={() => {
            setCreated(null);
            setCreating(false);
          }}
          onSubmit={() => {
            setCreated(null);
            setCreating(false);
            showToast(`Schlüssel „${created.name}“ erstellt`);
          }}
          saving={false}
          error=""
          submitLabel="Fertig"
          extraActions={
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(created.key)
                  .then(() => showToast("Schlüssel kopiert"))
                  .catch(() => showToast("Kopieren nicht möglich – bitte markieren und kopieren"))
              }
            >
              Kopieren
            </button>
          }
        >
          <label className="area-editor-wide">
            <span>Schlüssel</span>
            <input value={created.key} readOnly onFocus={(event) => event.currentTarget.select()} />
          </label>
          <label className="area-editor-wide">
            <span>Anfrage</span>
            <input value={`Authorization: Bearer ${created.key.slice(0, 12)}…`} readOnly />
          </label>
        </EditorDialog>
      )}
      {revoking && (
        <EditorDialog
          id="api-key-revoke"
          eyebrow="Schnittstelle · FHIR"
          title={`„${revoking.name}“ widerrufen`}
          description="Das angebundene System erhält danach keinen Zugriff mehr. Das lässt sich nicht rückgängig machen; bei Bedarf einen neuen Schlüssel erstellen."
          onClose={() => setRevoking(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson("/api/admin/api-keys", { method: "DELETE", body: { keyId: revoking.id } });
              setRevoking(null);
              data.reload();
              showToast(`Schlüssel „${revoking.name}“ widerrufen`);
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Widerrufen"
          danger
        >
          <p className="area-editor-wide">
            {revoking.prefix}… · {revoking.scopes.map((scope) => API_SCOPES[scope]).join(", ")}
          </p>
        </EditorDialog>
      )}
    </section>
  );
}
