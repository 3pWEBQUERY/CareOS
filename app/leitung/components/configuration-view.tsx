"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { EditorDialog, LoadError, formatDateTime, requestJson } from "@/app/components/workspace-ui";
import { loadWorkContext } from "@/app/components/care-context";
import type { SystemStatus } from "@/lib/settings";
import { TERMINOLOGIES, type TerminologyKey } from "@/lib/terminology";
import { VITAL_METRICS } from "@/lib/vitals-shared";
import { LOGO_UPLOAD_MAX_BYTES } from "@/lib/branding-shared";
import { logoDataUrl } from "./logo-file";
import { SETTING_DEFINITIONS, SETTING_KEYS, type AppSettings, type SettingKey } from "@/lib/settings-shared";
import { notifyAdminChanged } from "./admin-board";
import { RetentionCard, WaitlistRetentionCard } from "./retention-card";
import { AssessmentInstrumentsCard } from "./assessment-instruments-card";
import { ConsentTopicsCard, DeathChecklistCard } from "./death-checklist-card";
import { ApiKeysCard } from "./api-keys-card";
import { WebhooksCard } from "./webhooks-card";
import { SsoCard } from "./sso-card";
import { InteractionsCard } from "./interactions-card";
import { CountryCard } from "./country-card";
import { InsurersCard } from "./insurers-card";
import { ActivityLeadersCard } from "./activity-leaders-card";
import type { CountryCode } from "@/lib/country";

export type ConfigurationData = {
  data?: {
    settings: AppSettings;
    system: SystemStatus;
    terminology: TerminologyKey;
    hiddenVitals: string[];
    logoUpdatedAt: string | null;
    organizationName: string;
    country: { country: CountryCode; region: string | null; confirmed: boolean };
  };
  error?: string;
  loading: boolean;
  reload: () => void;
};

// "Leitung · Konfiguration": organisation-wide settings and the live system status.
export function ConfigurationView({
  configuration,
  showToast,
  selectedKey,
  onSelect,
  editorOpen,
  onCloseEditor,
}: {
  configuration: ConfigurationData;
  showToast: (message: string) => void;
  selectedKey: SettingKey;
  onSelect: (key: SettingKey) => void;
  editorOpen: boolean;
  onCloseEditor: () => void;
}) {
  const { data, error, reload } = configuration;
  const [saving, setSaving] = useState<SettingKey | "terminology" | "vitals" | "logo" | null>(null);
  // Aus der Ersteinrichtung (#name, #land): nach dem Laden zur Karte springen.
  const loaded = Boolean(data);
  useEffect(() => {
    const anchor = loaded ? window.location.hash.slice(1) : "";
    if (!anchor) return;
    const timer = window.setTimeout(
      () => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
    return () => window.clearTimeout(timer);
  }, [loaded]);
  if (error && !data) return <LoadError message={error} onRetry={reload} />;

  const save = async (key: SettingKey, change: { enabled?: boolean; value?: number }) => {
    setSaving(key);
    try {
      await requestJson(`/api/settings/${key}`, { method: "PATCH", body: change });
      reload();
      notifyAdminChanged();
      void loadWorkContext(true);
      const title = SETTING_DEFINITIONS[key].title;
      showToast(
        change.enabled === undefined
          ? `${title} gespeichert`
          : `${title} ${change.enabled ? "eingeschaltet" : "ausgeschaltet"}`,
      );
      return true;
    } catch (reason) {
      showToast((reason as Error).message);
      return false;
    } finally {
      setSaving(null);
    }
  };
  const saveTerminology = async (value: TerminologyKey) => {
    setSaving("terminology");
    try {
      await requestJson("/api/settings/terminology", { method: "PATCH", body: { value } });
      reload();
      notifyAdminChanged();
      void loadWorkContext(true);
      showToast(`Bezeichnung „${TERMINOLOGIES[value].label}“ gespeichert – gilt nach dem Neuladen überall`);
    } catch (reason) {
      showToast((reason as Error).message);
    } finally {
      setSaving(null);
    }
  };
  const toggleVital = async (key: string) => {
    if (!data) return;
    const hidden = data.hiddenVitals.includes(key)
      ? data.hiddenVitals.filter((item) => item !== key)
      : [...data.hiddenVitals, key];
    setSaving("vitals");
    try {
      await requestJson("/api/settings/vitals", { method: "PATCH", body: { hidden } });
      reload();
      notifyAdminChanged();
      void loadWorkContext(true);
      showToast(`${key} ${hidden.includes(key) ? "wird nicht mehr erfasst" : "wird erfasst"}`);
    } catch (reason) {
      showToast((reason as Error).message);
    } finally {
      setSaving(null);
    }
  };
  const changeLogo = async (file: File | null) => {
    setSaving("logo");
    try {
      if (file) {
        await requestJson("/api/branding/logo", { method: "PUT", body: { logoDataUrl: await logoDataUrl(file) } });
      } else await requestJson("/api/branding/logo", { method: "DELETE" });
      reload();
      notifyAdminChanged();
      void loadWorkContext(true);
      showToast(file ? "Logo gespeichert – gilt nach dem Neuladen überall" : "Logo entfernt");
    } catch (reason) {
      showToast((reason as Error).message);
    } finally {
      setSaving(null);
    }
  };
  const system = data?.system;
  const healthy = system ? system.databaseMs < 1000 : true;

  return (
    <div className="admin-config-layout">
      <section className="card admin-config-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Systemsteuerung</p>
            <h2 className="card-title">Konfiguration</h2>
            <p className="card-subtitle">Einstellungen für alle Mitarbeitenden der Organisation</p>
          </div>
          <span className={`status-badge ${healthy ? "stable" : "attention"}`}>
            {healthy ? "System aktiv" : "System langsam"}
          </span>
        </div>
        <div className="admin-setting-list">
          {SETTING_KEYS.map((key) => {
            const definition = SETTING_DEFINITIONS[key];
            const setting = data?.settings[key];
            const on = setting?.enabled ?? false;
            return (
              <button
                className={selectedKey === key ? "selected" : ""}
                type="button"
                key={key}
                onClick={() => onSelect(key)}
              >
                <span className={`governance-icon ${on ? "stable" : "attention"}`}>
                  <ModuleIcon name={definition.icon} />
                </span>
                <span>
                  <strong>{definition.title}</strong>
                  <small>
                    {definition.area} · {definition.describe(setting?.value ?? definition.defaults.value)}
                  </small>
                </span>
                <span className={`status-badge ${on ? "stable" : "attention"}`}>{on ? "Aktiv" : "Aus"}</span>
                {/* Quick switch; keyboard users change the setting via "Einstellung ändern". */}
                <span
                  className={`admin-toggle ${on ? "on" : ""}`}
                  aria-hidden="true"
                  title={on ? "Ausschalten" : "Einschalten"}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (data && saving !== key) void save(key, { enabled: !on });
                  }}
                />
              </button>
            );
          })}
        </div>
      </section>
      <div className="admin-config-side">
        <aside className="card admin-system-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Systemstatus</p>
              <h2 className="card-title">Integrität</h2>
            </div>
          </div>
          <div className="admin-system-score">
            <strong>{system ? `${system.databaseMs} ms` : "–"}</strong>
            <span>Antwortzeit der Datenbank</span>
          </div>
          <ul>
            <li>
              <ModuleIcon name={system ? "check" : "pulse"} />{" "}
              {system ? "Datenbank verbunden" : "Verbindung wird geprüft …"}
            </li>
            <li>
              <ModuleIcon name="check" />{" "}
              {system?.schemaVersion
                ? `Datenbankstand ${system.schemaVersion} · ${system.migrations} Migrationen`
                : "Datenbankstand wird geladen"}
            </li>
            <li>
              <ModuleIcon name="check" />{" "}
              {system
                ? `${system.auditEntries30Days} protokollierte Änderungen in 30 Tagen${
                    system.lastAuditAt ? ` · zuletzt ${formatDateTime(system.lastAuditAt)}` : ""
                  }`
                : "Protokoll wird geladen"}
            </li>
            {system && (
              <li className={system.errors.last24h ? "admin-system-errors" : ""}>
                <ModuleIcon name={system.errors.last24h ? "alert" : "check"} />{" "}
                {system.errors.last24h
                  ? `${system.errors.last24h} Serverfehler in 24 Stunden · zuletzt ${formatDateTime(
                      system.errors.recent[0]?.at ?? "",
                    )}: ${system.errors.recent[0]?.source ?? ""}`
                  : "Keine Serverfehler in 24 Stunden"}
              </li>
            )}
          </ul>
          <button
            className="secondary-button"
            type="button"
            onClick={() => document.getElementById("admin-log")?.scrollIntoView({ behavior: "smooth" })}
          >
            Protokoll ansehen <ModuleIcon name="chevron" />
          </button>
        </aside>
        {data && (
          <CountryCard
            country={data.country.country}
            region={data.country.region}
            confirmed={data.country.confirmed}
            onSaved={reload}
            showToast={showToast}
          />
        )}
        <section className="card admin-terminology-card" aria-labelledby="admin-terminology-title">
          <div className="card-header">
            <div>
              <p className="eyebrow">Sprache</p>
              <h2 className="card-title" id="admin-terminology-title">
                Bezeichnung der betreuten Personen
              </h2>
              <p className="card-subtitle">Gilt für alle Mitarbeitenden, z. B. „Patientenakte“ statt „Bewohnerakte“</p>
            </div>
          </div>
          <div className="worklist-filters admin-terminology-options" role="group" aria-label="Bezeichnung wählen">
            {(Object.keys(TERMINOLOGIES) as TerminologyKey[]).map((key) => (
              <button
                className={data?.terminology === key ? "active" : ""}
                type="button"
                key={key}
                aria-pressed={data?.terminology === key}
                disabled={!data || saving === "terminology"}
                onClick={() => data?.terminology !== key && void saveTerminology(key)}
              >
                {TERMINOLOGIES[key].label}
              </button>
            ))}
          </div>
        </section>
        <section className="card admin-terminology-card" aria-labelledby="admin-vitals-title">
          <div className="card-header">
            <div>
              <p className="eyebrow">Vitalwerte</p>
              <h2 className="card-title" id="admin-vitals-title">
                Erfasste Vitalparameter
              </h2>
              <p className="card-subtitle">Ausgeschaltete Werte erscheinen nicht mehr in Messung und Übersicht</p>
            </div>
          </div>
          <div className="worklist-filters admin-terminology-options" role="group" aria-label="Vitalparameter wählen">
            {VITAL_METRICS.map((metric) => (
              <button
                className={data && !data.hiddenVitals.includes(metric.key) ? "active" : ""}
                type="button"
                key={metric.key}
                aria-pressed={!!data && !data.hiddenVitals.includes(metric.key)}
                disabled={!data || saving === "vitals"}
                onClick={() => void toggleVital(metric.key)}
              >
                {metric.key}
              </button>
            ))}
          </div>
        </section>
        <section
          className="card admin-terminology-card admin-branding-card"
          id="name"
          aria-labelledby="admin-branding-title"
        >
          <div className="card-header">
            <div>
              <p className="eyebrow">Branding</p>
              <h2 className="card-title" id="admin-branding-title">
                Name und Logo der Einrichtung
              </h2>
              <p className="card-subtitle">
                Erscheinen in der Kopfzeile · Logo als JPEG, PNG oder WebP bis {LOGO_UPLOAD_MAX_BYTES / 1024 / 1024} MB;
                grosse Bilder werden verkleinert
              </p>
            </div>
          </div>
          {data && (
            <OrganizationNameForm
              key={data.organizationName}
              current={data.organizationName}
              onSaved={(name) => {
                reload();
                notifyAdminChanged();
                void loadWorkContext(true);
                showToast(`Name gespeichert: ${name}`);
              }}
              onError={showToast}
            />
          )}
          <div className="admin-branding-body">
            <span className="admin-branding-preview">
              {data?.logoUpdatedAt ? (
                <Image
                  src={`/api/branding/logo?v=${encodeURIComponent(data.logoUpdatedAt)}`}
                  alt="Aktuelles Logo"
                  width={48}
                  height={48}
                  unoptimized
                />
              ) : (
                <ModuleIcon name="building" />
              )}
            </span>
            <label className="secondary-button admin-branding-upload">
              {data?.logoUpdatedAt ? "Logo ersetzen" : "Logo hochladen"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={!data || saving === "logo"}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  if (file) void changeLogo(file);
                }}
              />
            </label>
            {data?.logoUpdatedAt && (
              <button
                className="quiet-button"
                type="button"
                disabled={saving === "logo"}
                onClick={() => void changeLogo(null)}
              >
                Logo entfernen
              </button>
            )}
          </div>
        </section>
        <RetentionCard showToast={showToast} />
        <WaitlistRetentionCard showToast={showToast} />
        <AssessmentInstrumentsCard showToast={showToast} />
        <DeathChecklistCard showToast={showToast} />
        <ConsentTopicsCard showToast={showToast} />
        <InsurersCard showToast={showToast} />
        <ActivityLeadersCard showToast={showToast} />
        <ApiKeysCard showToast={showToast} />
        <WebhooksCard showToast={showToast} />
        <SsoCard showToast={showToast} />
        <InteractionsCard showToast={showToast} />
      </div>
      {editorOpen && data && (
        <SettingEditor
          key={selectedKey}
          settingKey={selectedKey}
          settings={data.settings}
          saving={saving === selectedKey}
          onClose={onCloseEditor}
          onSave={async (change) => (await save(selectedKey, change)) && onCloseEditor()}
        />
      )}
    </div>
  );
}

function SettingEditor({
  settingKey,
  settings,
  saving,
  onClose,
  onSave,
}: {
  settingKey: SettingKey;
  settings: AppSettings;
  saving: boolean;
  onClose: () => void;
  onSave: (change: { enabled: boolean; value?: number }) => void;
}) {
  const definition = SETTING_DEFINITIONS[settingKey];
  const [enabled, setEnabled] = useState(settings[settingKey].enabled);
  const [value, setValue] = useState(String(settings[settingKey].value ?? ""));
  return (
    <EditorDialog
      id="setting-editor"
      title={definition.title}
      eyebrow={`Konfiguration · ${definition.area}`}
      description={definition.describe(Number(value) || definition.defaults.value)}
      submitLabel="Speichern"
      saving={saving}
      error=""
      onClose={onClose}
      onSubmit={() => onSave(definition.unit ? { enabled, value: Number(value) } : { enabled })}
    >
      <fieldset className="area-editor-wide">
        <legend>Status</legend>
        <div className="area-service-options">
          <label>
            <input type="checkbox" checked={enabled} onChange={() => setEnabled((current) => !current)} />
            <span>Für alle Mitarbeitenden eingeschaltet</span>
          </label>
        </div>
      </fieldset>
      {definition.unit && (
        <label>
          {definition.defaults.value === null
            ? `${definition.unit} (legt die Einrichtung fest)`
            : `${definition.unit} (Standard ${definition.defaults.value})`}
          <input
            type="number"
            min={definition.min}
            max={definition.max}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </label>
      )}
    </EditorDialog>
  );
}

// Name der Einrichtung (Kopfzeile); beim Installieren gesetzt, hier jederzeit änderbar.
function OrganizationNameForm({
  current,
  onSaved,
  onError,
}: {
  current: string;
  onSaved: (name: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const changed = name.trim() !== current && name.trim().length > 0;
  return (
    <form
      className="admin-organization-name"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        requestJson<{ name: string }>("/api/branding/name", { method: "PUT", body: { name } })
          .then((result) => onSaved(result.name))
          .catch((reason: Error) => onError(reason.message))
          .finally(() => setSaving(false));
      }}
    >
      <label>
        <span>Name der Einrichtung</span>
        <input value={name} maxLength={180} onChange={(event) => setName(event.target.value)} required />
      </label>
      <button className="secondary-button" type="submit" disabled={!changed || saving}>
        Speichern
      </button>
    </form>
  );
}
