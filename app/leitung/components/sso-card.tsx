"use client";

import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, formatDateTime, requestJson, useApiData } from "@/app/components/workspace-ui";
import { SSO_CLAIMS, type SsoClaim, type SsoSettings } from "@/lib/sso-shared";

// SSO über OpenID Connect: Identity-Provider der Einrichtung eintragen, Verbindung prüfen, einschalten.
export function SsoCard({ showToast }: { showToast: (message: string) => void }) {
  const data = useApiData<{ settings: SsoSettings; redirectUri: string }>("/api/admin/sso");
  const [editing, setEditing] = useState<
    (Omit<SsoSettings, "hasSecret" | "updatedAt"> & { clientSecret: string }) | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const settings = data.data?.settings;
  const configured = Boolean(settings?.issuer);

  const check = async () => {
    try {
      const result = await requestJson<{ issuer: string }>("/api/admin/sso", { method: "POST" });
      showToast(`Verbindung in Ordnung: ${result.issuer}`);
    } catch (cause) {
      showToast((cause as Error).message);
    }
  };

  return (
    <section className="card admin-terminology-card admin-sso-card" aria-labelledby="admin-sso-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Anmeldung</p>
          <h2 className="card-title" id="admin-sso-title">
            SSO (OpenID Connect)
          </h2>
          <p className="card-subtitle">
            {settings?.enabled
              ? `Eingeschaltet · ${settings.issuer} · Knopf „Mit ${settings.buttonLabel} anmelden“`
              : configured
                ? `Eingerichtet, ausgeschaltet · ${settings?.issuer}`
                : "Anmeldung über den Identity-Provider der Einrichtung (z. B. Keycloak, Entra ID, Google)"}
          </p>
        </div>
        {settings?.enabled && <span className="status-badge">Ein</span>}
      </div>
      <div className="admin-retention-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {data.data && (
          <p className="list-hint">
            Rücksprungadresse beim Identity-Provider eintragen: <code>{data.data.redirectUri}</code>. Angemeldet werden
            nur bestehende CareOS-Konten, deren Benutzername dem gewählten Claim entspricht.
            {settings?.updatedAt ? ` Zuletzt geändert ${formatDateTime(settings.updatedAt)}.` : ""}
          </p>
        )}
      </div>
      <div className="admin-branding-body">
        <button
          className="secondary-button"
          type="button"
          disabled={!settings}
          onClick={() => {
            if (!settings) return;
            setEditing({
              enabled: settings.enabled,
              issuer: settings.issuer,
              clientId: settings.clientId,
              usernameClaim: settings.usernameClaim,
              buttonLabel: settings.buttonLabel,
              clientSecret: "",
            });
            setError("");
          }}
        >
          {configured ? "SSO bearbeiten" : "SSO einrichten"}
        </button>
        {configured && (
          <button className="quiet-button" type="button" onClick={() => void check()}>
            Verbindung prüfen
          </button>
        )}
      </div>
      {editing && settings && (
        <EditorDialog
          id="sso-editor"
          eyebrow="Anmeldung · OpenID Connect"
          title={configured ? "SSO bearbeiten" : "SSO einrichten"}
          description="Beim Identity-Provider eine Anwendung (Client) mit der Rücksprungadresse anlegen und hier Adresse, Client-ID und Client-Secret eintragen."
          onClose={() => setEditing(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson("/api/admin/sso", { method: "PUT", body: editing });
              setEditing(null);
              data.reload();
              showToast(editing.enabled ? "SSO gespeichert und eingeschaltet" : "SSO gespeichert");
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Speichern"
        >
          <label className="area-editor-wide">
            <span>Adresse des Identity-Providers (Issuer)</span>
            <input
              value={editing.issuer}
              onChange={(event) => setEditing({ ...editing, issuer: event.target.value })}
              placeholder="https://login.example.org/realms/pflege"
              required
            />
          </label>
          <label>
            <span>Client-ID</span>
            <input
              value={editing.clientId}
              onChange={(event) => setEditing({ ...editing, clientId: event.target.value })}
              required
            />
          </label>
          <label>
            <span>Client-Secret</span>
            <input
              type="password"
              autoComplete="new-password"
              value={editing.clientSecret}
              onChange={(event) => setEditing({ ...editing, clientSecret: event.target.value })}
              placeholder={settings.hasSecret ? "Unverändert lassen" : ""}
            />
          </label>
          <label>
            <span>Benutzername in CareOS entspricht</span>
            <CareSelect
              label="Claim"
              value={SSO_CLAIMS[editing.usernameClaim]}
              options={Object.values(SSO_CLAIMS)}
              onChange={(value) =>
                setEditing({
                  ...editing,
                  usernameClaim:
                    (Object.keys(SSO_CLAIMS) as SsoClaim[]).find((key) => SSO_CLAIMS[key] === value) ??
                    editing.usernameClaim,
                })
              }
            />
          </label>
          <label>
            <span>Bezeichnung auf der Anmeldeseite</span>
            <input
              value={editing.buttonLabel}
              maxLength={60}
              onChange={(event) => setEditing({ ...editing, buttonLabel: event.target.value })}
              placeholder="z. B. Microsoft"
            />
          </label>
          <fieldset className="area-editor-wide">
            <legend>Status</legend>
            <div className="area-service-options">
              <label>
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={() => setEditing({ ...editing, enabled: !editing.enabled })}
                />
                <span>Anmeldung über SSO anbieten</span>
              </label>
            </div>
          </fieldset>
        </EditorDialog>
      )}
    </section>
  );
}
