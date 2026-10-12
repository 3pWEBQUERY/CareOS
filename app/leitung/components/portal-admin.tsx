"use client";

import { useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import { useTerms } from "@/app/components/care-context";
import {
  EditorDialog,
  LoadError,
  formatDate,
  formatDateTime,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  PORTAL_AREAS,
  PORTAL_AREA_KEYS,
  portalAreaAllowed,
  PORTAL_BASES,
  PORTAL_KINDS,
  ORDER_STATUSES,
  type PortalAccessEntry,
  type PortalAccount,
  type PortalArea,
  type PortalBasis,
  type PortalGrant,
  type PortalKind,
} from "@/lib/portal-shared";

type Payload = {
  accounts: PortalAccount[];
  residents: Array<{ id: string; name: string }>;
  careUnits: Array<{ id: string; name: string }>;
};
type AccountDraft = {
  id: string | null;
  kind: PortalKind;
  displayName: string;
  username: string;
  email: string;
  phone: string;
  active: boolean;
};
type GrantDraft = {
  id: string | null;
  scope: "resident" | "unit";
  residentId: string;
  careUnitId: string;
  areas: PortalArea[];
  validFrom: string;
  validUntil: string;
  basis: PortalBasis | "";
  basisNote: string;
};

const ACTIONS: Record<string, string> = {
  resident_viewed: "Daten angesehen",
  password_changed: "Passwort geändert",
  message_sent: "Nachricht gesendet",
  visit_answered: "Rückmeldung zur Visite erfasst",
  ...Object.fromEntries(
    Object.entries(ORDER_STATUSES).map(([status, label]) => [`order_${status}`, `Bestellung ${label.toLowerCase()}`]),
  ),
};

const grantScope = (grant: PortalGrant) =>
  grant.residentName ?? (grant.careUnitName ? `Wohnbereich ${grant.careUnitName}` : "–");

function grantState(grant: PortalGrant) {
  if (grant.revokedAt) return `widerrufen ${formatDate(grant.revokedAt)}`;
  const period = [
    grant.validFrom && `ab ${formatDate(grant.validFrom)}`,
    grant.validUntil && `bis ${formatDate(grant.validUntil)}`,
  ]
    .filter(Boolean)
    .join(" ");
  return period || "unbefristet";
}

// Leitung › Administration › Portal: Zugänge für Angehörige und Ärztinnen/Ärzte, Freigaben je Person oder
// Wohnbereich mit einzeln gewählten Bereichen, Gültigkeit und Grundlage, Zugriffsprotokoll.
export default function PortalAdmin() {
  return (
    <ModulePageShell
      activeModule="admin"
      activeChild="Portal"
      pageClass="leadership-page leadership-users portal-admin-page"
    >
      {(showToast) => <PortalAdminBody showToast={showToast} />}
    </ModulePageShell>
  );
}

function PortalAdminBody({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const data = useApiData<Payload>("/api/admin/portal");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountDraft | null>(null);
  const [grant, setGrant] = useState<GrantDraft | null>(null);
  const [revoking, setRevoking] = useState<PortalGrant | null>(null);
  const [password, setPassword] = useState<{ name: string; username: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const accounts = data.data?.accounts ?? [];
  const selected = accounts.find((entry) => entry.id === selectedId) ?? accounts[0] ?? null;
  const log = useApiData<{ entries: PortalAccessEntry[] }>(
    selected ? `/api/admin/portal/log?accountId=${selected.id}` : null,
  );
  const activeGrants = (entry: PortalAccount) => entry.grants.filter((item) => !item.revokedAt).length;

  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveAccount = () =>
    run(async () => {
      if (!account) return;
      if (account.id) {
        await requestJson("/api/admin/portal", { method: "PATCH", body: account });
        showToast("Portal-Zugang gespeichert");
      } else {
        const created = await requestJson<{ id: string; password: string }>("/api/admin/portal", {
          method: "POST",
          body: account,
        });
        setSelectedId(created.id);
        setPassword({ name: account.displayName, username: account.username.toLowerCase(), value: created.password });
      }
      setAccount(null);
      data.reload();
    });

  const saveGrant = () =>
    run(async () => {
      if (!grant || !selected) return;
      const body = {
        id: grant.id,
        accountId: selected.id,
        residentId: grant.scope === "resident" ? grant.residentId : null,
        careUnitId: grant.scope === "unit" ? grant.careUnitId : null,
        areas: grant.areas,
        validFrom: grant.validFrom || null,
        validUntil: grant.validUntil || null,
        basis: grant.basis,
        basisNote: grant.basisNote,
      };
      await requestJson("/api/admin/portal/grants", { method: grant.id ? "PATCH" : "POST", body });
      setGrant(null);
      data.reload();
      showToast(grant.id ? "Freigabe gespeichert" : "Freigabe erteilt");
    });

  const resetPassword = (entry: PortalAccount) =>
    run(async () => {
      const result = await requestJson<{ password: string }>("/api/admin/portal/password", {
        method: "POST",
        body: { accountId: entry.id },
      });
      setPassword({ name: entry.displayName, username: entry.username, value: result.password });
      data.reload();
    });

  return (
    <main className="workspace leadership-workspace leadership-users portal-admin">
      <header className="leadership-heading page-heading">
        <div className="heading-copy">
          <p className="eyebrow">Administration</p>
          <h1>Portal</h1>
          <p>Zugänge für Angehörige und Ärztinnen/Ärzte mit individuellen Freigaben je {t.one} oder Wohnbereich.</p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setAccount({
              id: null,
              kind: "relative",
              displayName: "",
              username: "",
              email: "",
              phone: "",
              active: true,
            });
            setError("");
          }}
        >
          <ModuleIcon name="plus" className="button-icon" />
          Zugang anlegen
        </button>
      </header>
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <div className="portal-admin-grid">
        <section className="card admin-terminology-card portal-accounts-card" aria-labelledby="portal-accounts-title">
          <div className="card-header">
            <div>
              <p className="eyebrow">Zugänge</p>
              <h2 className="card-title" id="portal-accounts-title">
                Portal-Zugänge
              </h2>
              <p className="card-subtitle">
                {accounts.filter((entry) => entry.active).length} aktiv · Anmeldung unter /portal
              </p>
            </div>
          </div>
          <div className="admin-retention-list">
            {accounts.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={`admin-retention-row portal-account-row ${selected?.id === entry.id ? "active" : ""}`}
                aria-pressed={selected?.id === entry.id}
                onClick={() => setSelectedId(entry.id)}
              >
                <span>
                  <strong>
                    {entry.displayName} <small>{PORTAL_KINDS[entry.kind]}</small>
                  </strong>
                  <small>
                    {entry.username} · {activeGrants(entry)} Freigabe{activeGrants(entry) === 1 ? "" : "n"}
                    {entry.active ? "" : " · gesperrt"}
                  </small>
                </span>
                <ModuleIcon name="chevron" />
              </button>
            ))}
            {data.data && !accounts.length && <p className="list-hint">Noch kein Portal-Zugang angelegt.</p>}
          </div>
        </section>
        {selected && (
          <section className="card admin-terminology-card portal-account-detail" aria-labelledby="portal-detail-title">
            <div className="card-header">
              <div>
                <p className="eyebrow">{PORTAL_KINDS[selected.kind]}</p>
                <h2 className="card-title" id="portal-detail-title">
                  {selected.displayName}
                </h2>
                <p className="card-subtitle">
                  {[selected.username, selected.email, selected.phone].filter(Boolean).join(" · ")}
                  {" · "}
                  {selected.lastLoginAt
                    ? `zuletzt angemeldet ${formatDateTime(selected.lastLoginAt)}`
                    : "noch nie angemeldet"}
                  {selected.mustChangePassword ? " · Einmal-Passwort noch nicht geändert" : ""}
                </p>
              </div>
              <span className={`status-badge ${selected.active ? "stable" : "critical"}`}>
                {selected.active ? "Aktiv" : "Gesperrt"}
              </span>
            </div>
            <div className="admin-branding-body">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setGrant({
                    id: null,
                    scope: "resident",
                    residentId: "",
                    careUnitId: "",
                    areas: [],
                    validFrom: "",
                    validUntil: "",
                    basis: "",
                    basisNote: "",
                  });
                  setError("");
                }}
              >
                Freigabe erteilen
              </button>
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  setAccount({ ...selected });
                  setError("");
                }}
              >
                Zugang bearbeiten
              </button>
              <button
                className="quiet-button"
                type="button"
                disabled={saving}
                onClick={() => void resetPassword(selected)}
              >
                Neues Einmal-Passwort
              </button>
            </div>
            <div className="admin-retention-list">
              {selected.grants.map((item) => (
                <div className={`admin-retention-row ${item.revokedAt ? "portal-grant-revoked" : ""}`} key={item.id}>
                  <span>
                    <strong>
                      {grantScope(item)} <small>{grantState(item)}</small>
                    </strong>
                    <small>{item.areas.map((area) => PORTAL_AREAS[area]).join(" · ")}</small>
                    <small>
                      Grundlage: {PORTAL_BASES[item.basis]}
                      {item.basisNote ? ` (${item.basisNote})` : ""} · erteilt {formatDate(item.createdAt)}
                      {item.createdBy ? ` von ${item.createdBy}` : ""}
                    </small>
                  </span>
                  {!item.revokedAt && (
                    <div className="admin-webhook-actions">
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => {
                          setGrant({
                            id: item.id,
                            scope: item.residentId ? "resident" : "unit",
                            residentId: item.residentId ?? "",
                            careUnitId: item.careUnitId ?? "",
                            areas: item.areas,
                            validFrom: item.validFrom ?? "",
                            validUntil: item.validUntil ?? "",
                            basis: item.basis,
                            basisNote: item.basisNote,
                          });
                          setError("");
                        }}
                      >
                        Bearbeiten
                      </button>
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => {
                          setRevoking(item);
                          setError("");
                        }}
                      >
                        Widerrufen
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!selected.grants.length && (
                <p className="list-hint">Noch keine Freigabe – ohne Freigabe sieht der Zugang keine Daten.</p>
              )}
            </div>
            <div className="portal-access-log">
              <p className="eyebrow">Zugriffe (letzte 100)</p>
              {(log.data?.entries ?? []).map((entry) => (
                <p key={entry.id}>
                  <span>{formatDateTime(entry.createdAt)}</span>
                  {ACTIONS[entry.action] ?? "Zugriff"}
                  {entry.residentName ? ` · ${entry.residentName}` : ""}
                </p>
              ))}
              {log.data && !log.data.entries.length && <p className="list-hint">Noch keine Zugriffe.</p>}
            </div>
          </section>
        )}
      </div>

      {account && (
        <EditorDialog
          id="portal-account-editor"
          eyebrow="Portal · Zugang"
          title={account.id ? "Zugang bearbeiten" : "Zugang anlegen"}
          description={
            account.id
              ? "Ein gesperrter Zugang kann sich nicht mehr anmelden; laufende Sitzungen enden sofort."
              : "Nach dem Anlegen erscheint ein Einmal-Passwort. Es wird nur einmal angezeigt und muss bei der ersten Anmeldung geändert werden."
          }
          onClose={() => setAccount(null)}
          onSubmit={saveAccount}
          saving={saving}
          error={error}
          submitLabel={account.id ? "Speichern" : "Anlegen"}
        >
          {!account.id && (
            <fieldset className="area-editor-wide">
              <legend>Art</legend>
              <div className="area-service-options">
                {(Object.keys(PORTAL_KINDS) as PortalKind[]).map((kind) => (
                  <label key={kind}>
                    <input
                      type="radio"
                      name="portal-kind"
                      checked={account.kind === kind}
                      onChange={() => setAccount({ ...account, kind })}
                    />
                    <span>{PORTAL_KINDS[kind]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label>
            <span>Name</span>
            <input
              value={account.displayName}
              maxLength={160}
              onChange={(event) => setAccount({ ...account, displayName: event.target.value })}
              required
            />
          </label>
          <label>
            <span>Benutzername</span>
            <input
              value={account.username}
              maxLength={80}
              disabled={Boolean(account.id)}
              onChange={(event) => setAccount({ ...account, username: event.target.value })}
              required
            />
          </label>
          <label>
            <span>E-Mail</span>
            <input
              type="email"
              value={account.email}
              maxLength={200}
              onChange={(event) => setAccount({ ...account, email: event.target.value })}
            />
          </label>
          <label>
            <span>Telefon</span>
            <input
              value={account.phone}
              maxLength={60}
              onChange={(event) => setAccount({ ...account, phone: event.target.value })}
            />
          </label>
          {account.id && (
            <fieldset className="area-editor-wide">
              <legend>Status</legend>
              <div className="area-service-options">
                <label>
                  <input
                    type="checkbox"
                    checked={account.active}
                    onChange={() => setAccount({ ...account, active: !account.active })}
                  />
                  <span>Zugang aktiv</span>
                </label>
              </div>
            </fieldset>
          )}
        </EditorDialog>
      )}

      {grant && selected && (
        <EditorDialog
          id="portal-grant-editor"
          eyebrow={`Portal · ${selected.displayName}`}
          title={grant.id ? "Freigabe bearbeiten" : "Freigabe erteilen"}
          description={`Welche Daten der Zugang sehen darf. Grunddaten (Name, Geburtsdatum, Wohnbereich, Zimmer) gehören zu jeder Freigabe. Ein Wohnbereich gilt für alle ${t.many}, die dort aktuell wohnen.`}
          onClose={() => setGrant(null)}
          onSubmit={saveGrant}
          saving={saving}
          error={error}
          submitLabel="Speichern"
        >
          <fieldset className="area-editor-wide">
            <legend>Freigabe für</legend>
            <div className="area-service-options">
              <label>
                <input
                  type="radio"
                  name="portal-scope"
                  checked={grant.scope === "resident"}
                  onChange={() => setGrant({ ...grant, scope: "resident" })}
                />
                <span>{t.one}</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="portal-scope"
                  checked={grant.scope === "unit"}
                  onChange={() => setGrant({ ...grant, scope: "unit" })}
                />
                <span>Wohnbereich</span>
              </label>
            </div>
          </fieldset>
          <label className="area-editor-wide">
            <span>{grant.scope === "resident" ? t.one : "Wohnbereich"}</span>
            {grant.scope === "resident" ? (
              <CareOptionSelect
                label={t.one}
                value={grant.residentId}
                options={(data.data?.residents ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
                onChange={(value) => setGrant({ ...grant, residentId: value })}
              />
            ) : (
              <CareOptionSelect
                label="Wohnbereich"
                value={grant.careUnitId}
                options={(data.data?.careUnits ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
                onChange={(value) => setGrant({ ...grant, careUnitId: value })}
              />
            )}
          </label>
          <fieldset className="area-editor-wide">
            <legend>Freigegebene Bereiche</legend>
            <div className="area-service-options">
              {PORTAL_AREA_KEYS.filter((area) => portalAreaAllowed(selected.kind, area)).map((area) => (
                <label key={area}>
                  <input
                    type="checkbox"
                    checked={grant.areas.includes(area)}
                    onChange={() =>
                      setGrant({
                        ...grant,
                        areas: grant.areas.includes(area)
                          ? grant.areas.filter((item) => item !== area)
                          : [...grant.areas, area],
                      })
                    }
                  />
                  <span>{PORTAL_AREAS[area]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            <span>Gültig ab</span>
            <CareDatePicker
              clearable
              label="Gültig ab"
              value={grant.validFrom}
              onChange={(value) => setGrant({ ...grant, validFrom: value })}
            />
          </label>
          <label>
            <span>Gültig bis</span>
            <CareDatePicker
              clearable
              label="Gültig bis"
              value={grant.validUntil}
              onChange={(value) => setGrant({ ...grant, validUntil: value })}
            />
          </label>
          <fieldset className="area-editor-wide">
            <legend>Grundlage</legend>
            <div className="area-service-options">
              {(Object.keys(PORTAL_BASES) as PortalBasis[]).map((basis) => (
                <label key={basis}>
                  <input
                    type="radio"
                    name="portal-basis"
                    checked={grant.basis === basis}
                    onChange={() => setGrant({ ...grant, basis })}
                  />
                  <span>{PORTAL_BASES[basis]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="area-editor-wide">
            <span>Vermerk zur Grundlage</span>
            <input
              value={grant.basisNote}
              maxLength={500}
              onChange={(event) => setGrant({ ...grant, basisNote: event.target.value })}
              placeholder="z. B. schriftliche Einwilligung vom …, Vorsorgeauftrag, Hausärztin"
            />
          </label>
        </EditorDialog>
      )}

      {revoking && (
        <EditorDialog
          id="portal-grant-revoke"
          eyebrow="Portal · Freigabe"
          title={`Freigabe „${grantScope(revoking)}“ widerrufen`}
          description="Der Zugang sieht diese Daten danach nicht mehr. Die Freigabe bleibt als widerrufen im Verlauf."
          onClose={() => setRevoking(null)}
          onSubmit={() =>
            run(async () => {
              await requestJson("/api/admin/portal/grants", { method: "DELETE", body: { id: revoking.id } });
              setRevoking(null);
              data.reload();
              showToast("Freigabe widerrufen");
            })
          }
          saving={saving}
          error={error}
          submitLabel="Widerrufen"
          danger
        >
          <p className="area-editor-wide">{revoking.areas.map((area) => PORTAL_AREAS[area]).join(" · ")}</p>
        </EditorDialog>
      )}

      {password && (
        <EditorDialog
          id="portal-password"
          eyebrow="Portal · Einmal-Passwort"
          title={`Einmal-Passwort für ${password.name}`}
          description="Nur jetzt sichtbar. Persönlich oder auf sicherem Weg übergeben; bei der ersten Anmeldung unter /portal muss es geändert werden."
          onClose={() => setPassword(null)}
          onSubmit={() => setPassword(null)}
          saving={false}
          error=""
          submitLabel="Fertig"
          extraActions={
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(password.value)
                  .then(() => showToast("Passwort kopiert"))
                  .catch(() => showToast("Kopieren nicht möglich – bitte markieren und kopieren"))
              }
            >
              Kopieren
            </button>
          }
        >
          <label>
            <span>Benutzername</span>
            <input value={password.username} readOnly />
          </label>
          <label>
            <span>Einmal-Passwort</span>
            <input value={password.value} readOnly onFocus={(event) => event.currentTarget.select()} />
          </label>
        </EditorDialog>
      )}
    </main>
  );
}
