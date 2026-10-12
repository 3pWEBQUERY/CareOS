"use client";

import { useState } from "react";
import { EditorDialog, formatDateTime, requestJson, useApiData } from "@/app/components/workspace-ui";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_KEYS, type WebhookEvent, type WebhookSummary } from "@/lib/webhooks-shared";

function deliveryState(hook: WebhookSummary) {
  const parts = [
    hook.lastDeliveryAt
      ? `zuletzt ${formatDateTime(hook.lastDeliveryAt)}: ${hook.lastError ?? `zugestellt (${hook.lastStatus})`}`
      : "noch keine Meldung",
  ];
  if (hook.pending) parts.push(`${hook.pending} ausstehend`);
  if (hook.failed) parts.push(`${hook.failed} gescheitert`);
  return parts.join(" · ");
}

// Webhooks: signierte Meldungen an angebundene Systeme. Das Geheimnis erscheint nur einmal nach dem Anlegen.
export function WebhooksCard({ showToast }: { showToast: (message: string) => void }) {
  const data = useApiData<{ webhooks: WebhookSummary[] }>("/api/admin/webhooks");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null);
  const [removing, setRemoving] = useState<WebhookSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const hooks = data.data?.webhooks ?? [];

  const ping = async (hook: WebhookSummary) => {
    try {
      await requestJson("/api/admin/webhooks/ping", { method: "POST", body: { webhookId: hook.id } });
      showToast(`Probemeldung an „${hook.name}“ vorgemerkt`);
      window.setTimeout(data.reload, 3000);
    } catch (cause) {
      showToast((cause as Error).message);
    }
  };

  return (
    <section className="card admin-terminology-card admin-webhooks-card" aria-labelledby="admin-webhooks-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Schnittstelle</p>
          <h2 className="card-title" id="admin-webhooks-title">
            Webhooks
          </h2>
          <p className="card-subtitle">
            Signierte Meldung bei Änderungen, nur mit Verweis · Daten liest das System über FHIR
          </p>
        </div>
        {hooks.length > 0 && <span className="status-badge">{hooks.length}</span>}
      </div>
      <div className="admin-retention-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {hooks.map((hook) => (
          <div className="admin-retention-row" key={hook.id}>
            <span>
              <strong>
                {hook.name} <small>{hook.url}</small>
              </strong>
              <small>{hook.events.map((event) => WEBHOOK_EVENTS[event]).join(", ")}</small>
              <small>{deliveryState(hook)}</small>
            </span>
            <div className="admin-webhook-actions">
              <button className="quiet-button" type="button" onClick={() => void ping(hook)}>
                Probe senden
              </button>
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  setRemoving(hook);
                  setError("");
                }}
              >
                Entfernen
              </button>
            </div>
          </div>
        ))}
        {data.data && !hooks.length && <p className="list-hint">Noch kein Webhook angelegt.</p>}
      </div>
      <div className="admin-branding-body">
        <button
          className="secondary-button"
          type="button"
          disabled={!data.data}
          onClick={() => {
            setCreating(true);
            setName("");
            setUrl("");
            setEvents([]);
            setError("");
          }}
        >
          Webhook anlegen
        </button>
      </div>
      {creating && !created && (
        <EditorDialog
          id="webhook-create"
          eyebrow="Schnittstelle · Webhooks"
          title="Webhook anlegen"
          description="CareOS meldet gewählte Ereignisse per POST an die Adresse, signiert mit einem Geheimnis. Die Meldung enthält nur den Verweis auf die FHIR-Ressource."
          onClose={() => setCreating(false)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              const result = await requestJson<{ secret: string }>("/api/admin/webhooks", {
                method: "POST",
                body: { name, url, events },
              });
              setCreated({ name, secret: result.secret });
              data.reload();
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Anlegen"
        >
          <label className="area-editor-wide">
            <span>Name</span>
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Spital Region"
              required
            />
          </label>
          <label className="area-editor-wide">
            <span>Adresse (https)</span>
            <input
              type="url"
              value={url}
              maxLength={500}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
              required
            />
          </label>
          <fieldset className="area-editor-wide">
            <legend>Ereignisse</legend>
            <div className="area-service-options">
              {WEBHOOK_EVENT_KEYS.map((event) => (
                <label key={event}>
                  <input
                    type="checkbox"
                    checked={events.includes(event)}
                    onChange={() =>
                      setEvents((current) =>
                        current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
                      )
                    }
                  />
                  <span>{WEBHOOK_EVENTS[event]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </EditorDialog>
      )}
      {created && (
        <EditorDialog
          id="webhook-created"
          eyebrow="Schnittstelle · Webhooks"
          title={`Geheimnis für „${created.name}“`}
          description="Damit prüft das angebundene System die Signatur (Kopfzeile X-CareCore-Signature). Jetzt kopieren – es wird nicht noch einmal angezeigt."
          onClose={() => {
            setCreated(null);
            setCreating(false);
          }}
          onSubmit={() => {
            setCreated(null);
            setCreating(false);
            showToast(`Webhook „${created.name}“ angelegt`);
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
                  ?.writeText(created.secret)
                  .then(() => showToast("Geheimnis kopiert"))
                  .catch(() => showToast("Kopieren nicht möglich – bitte markieren und kopieren"))
              }
            >
              Kopieren
            </button>
          }
        >
          <label className="area-editor-wide">
            <span>Geheimnis</span>
            <input value={created.secret} readOnly onFocus={(event) => event.currentTarget.select()} />
          </label>
        </EditorDialog>
      )}
      {removing && (
        <EditorDialog
          id="webhook-remove"
          eyebrow="Schnittstelle · Webhooks"
          title={`„${removing.name}“ entfernen`}
          description="Das System erhält danach keine Meldungen mehr; ausstehende Meldungen werden verworfen."
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson("/api/admin/webhooks", { method: "DELETE", body: { webhookId: removing.id } });
              setRemoving(null);
              data.reload();
              showToast(`Webhook „${removing.name}“ entfernt`);
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
          <p className="area-editor-wide">{removing.url}</p>
        </EditorDialog>
      )}
    </section>
  );
}
