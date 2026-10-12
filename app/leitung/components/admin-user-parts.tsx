"use client";

import type { Terms } from "@/lib/terminology";
import { type ReactNode } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import type { AdminCareUnit, AdminQualification, ManagedRole, ManagedUser } from "@/lib/admin-users";

export type Data = {
  users: ManagedUser[];
  careUnits: AdminCareUnit[];
  roles: ManagedRole[];
  qualifications: AdminQualification[];
  // E-Mail-Versand eingerichtet: Links zum Setzen des Passworts und Einladungen.
  mailEnabled?: boolean;
  inviteFailed?: boolean;
};

export const permissions = [
  "residents.read",
  "residents.write",
  "documentation.write",
  "medication.administer",
  "medication.manage",
  "schedule.manage",
  "team.manage",
  "quality.manage",
  "insights.read",
  "administration.manage",
  "rai.manage",
  "ai.use",
];

// Beschriftung eines Rechts; die Bewohner-Rechte mit der Bezeichnung der Einrichtung.
export const permissionLabel = (permission: string, t: Terms) =>
  permission === "residents.read"
    ? `${t.many} lesen`
    : permission === "residents.write"
      ? `${t.many} bearbeiten`
      : (labels[permission] ?? permission);

export const labels: Record<string, string> = {
  "residents.read": "Bewohner lesen",
  "residents.write": "Bewohner bearbeiten",
  "documentation.write": "Dokumentieren",
  "medication.administer": "Medikation verabreichen",
  "medication.manage": "Medikation verwalten",
  "schedule.manage": "Dienste",
  "team.manage": "Team",
  "quality.manage": "Qualität",
  "insights.read": "Kennzahlen",
  "administration.manage": "Administration",
  "rai.manage": "Kompass",
  "ai.use": "KI-Assistenz",
};

// Was ein Recht erlaubt, in Alltagssprache (statt technischer Schlüssel).
export const permissionHints: Record<string, string> = {
  "residents.read": "Akten, Verlauf und Übersichten ansehen",
  "residents.write": "Aufnahme, Stammdaten und Akten bearbeiten",
  "documentation.write": "Pflegedokumentation, Angebote und Protokolle erfassen",
  "medication.administer": "Medikamente in der Runde abgeben und dokumentieren",
  "medication.manage": "Verordnungen, Bestände und Bestellungen verwalten",
  "schedule.manage": "Dienstplan erstellen und veröffentlichen",
  "team.manage": "Mitarbeitende, Einarbeitung und Team führen",
  "quality.manage": "Qualität, Ereignisse und Rückmeldungen bearbeiten",
  "insights.read": "Kennzahlen und Auswertungen ansehen",
  "administration.manage": "Einstellungen, Rollen und Zugänge verwalten",
  "rai.manage": "Abklärungen mit dem Kompass durchführen und abschliessen",
  "ai.use": "Vorschläge der KI-Assistenz nutzen",
};

export function EmployeeFields(p: {
  name: string;
  setName: (v: string) => void;
  username: string;
  setUsername: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  job: string;
  setJob: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  unit: string;
  setUnit: (v: string) => void;
  roles: ManagedRole[];
  careUnits: AdminCareUnit[];
}) {
  return (
    <>
      <div className="user-editor-section-heading">
        <p className="eyebrow">Profil und Berechtigungen</p>
        <h3>Mitarbeiterprofil</h3>
      </div>
      <div className="user-editor-fields">
        <label>
          Name
          <input required value={p.name} onChange={(e) => p.setName(e.target.value)} />
        </label>
        <label>
          Benutzername
          <input required value={p.username} onChange={(e) => p.setUsername(e.target.value.replace(/\s/g, ""))} />
        </label>
        <label>
          Funktion
          <input value={p.job} onChange={(e) => p.setJob(e.target.value)} />
        </label>
        <label>
          Telefon
          <input value={p.phone} onChange={(e) => p.setPhone(e.target.value)} />
        </label>
        <label>
          E-Mail
          <input
            type="email"
            autoComplete="off"
            maxLength={200}
            value={p.email}
            onChange={(e) => p.setEmail(e.target.value.trim())}
            placeholder="Für „Passwort vergessen“"
          />
        </label>
      </div>
      <fieldset className="user-editor-role">
        <legend>Rolle</legend>
        <div>
          {p.roles.map((r) => (
            <button
              type="button"
              key={r.id}
              className={p.role === r.key ? "active" : ""}
              onClick={() => p.setRole(r.key)}
            >
              <strong>{r.name}</strong>
              <small>{r.description || "Individuell definierter Zugriff"}</small>
              {p.role === r.key && <ModuleIcon name="check" />}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="user-editor-role">
        <legend>Fester Arbeitsbereich</legend>
        <div>
          {p.careUnits.map((u) => (
            <button
              type="button"
              key={u.id}
              className={p.unit === u.id ? "active" : ""}
              onClick={() => p.setUnit(u.id)}
            >
              <strong>{u.name}</strong>
              <small>{u.detail}</small>
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

export function Confirm({
  mode,
  active,
  saving,
  error,
  onBack,
  onConfirm,
}: {
  mode: "lock" | "delete" | "mfa";
  active: boolean;
  saving: boolean;
  error: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const del = mode === "delete";
  const mfa = mode === "mfa";
  return (
    <div className="user-editor-confirm">
      <p className="eyebrow">{del ? "Irreversible Aktion" : mfa ? "Anmeldung" : "Kontostatus"}</p>
      <h3>
        {del
          ? "Mitarbeiter endgültig löschen"
          : mfa
            ? "Zwei-Faktor-Anmeldung zurücksetzen"
            : active
              ? "Mitarbeiter archivieren"
              : "Mitarbeiter wiederherstellen"}
      </h3>
      <p>
        {del
          ? "Das Konto und seine Sitzungen werden dauerhaft entfernt."
          : mfa
            ? "Für verlorene Handys: Die Person meldet sich danach nur mit dem Passwort an und kann die Zwei-Faktor-Anmeldung neu einrichten. Wird im Protokoll festgehalten."
            : "Das Profil wird als Archiv geführt und kann später wiederhergestellt werden."}
      </p>
      {error && <p className="user-editor-error">{error}</p>}
      <div className="user-editor-footer">
        <button className="secondary-button" type="button" onClick={onBack}>
          Abbrechen
        </button>
        <button
          className={del || active || mfa ? "danger-button" : "primary-button"}
          type="button"
          onClick={onConfirm}
          disabled={saving}
        >
          {del ? "Endgültig löschen" : mfa ? "Zurücksetzen" : active ? "Archivieren" : "Wiederherstellen"}
        </button>
      </div>
    </div>
  );
}

export function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="user-editor-overlay" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <section className="user-editor-panel" role="dialog" aria-modal="true">
        <header className="user-editor-header">
          <div>
            <p className="eyebrow">Administration · Zugriffsverwaltung</p>
            <h2>{title}</h2>
            <p>Änderungen werden nachvollziehbar im Änderungsprotokoll gespeichert.</p>
          </div>
          <button className="profile-panel-close" type="button" onClick={onClose}>
            <ModuleIcon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

// Qualifikationen einer Person (heute gültig); berechtigende Qualifikationen sind mit „Medikation“ gekennzeichnet.
export function QualificationFields({
  qualifications,
  selected,
  onChange,
}: {
  qualifications: AdminQualification[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (!qualifications.length) return null;
  return (
    <fieldset className="user-editor-role">
      <legend>Qualifikationen</legend>
      <div>
        {qualifications.map((q) => {
          const on = selected.includes(q.id);
          return (
            <button
              type="button"
              key={q.id}
              className={on ? "active" : ""}
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((id) => id !== q.id) : [...selected, q.id])}
            >
              <strong>{q.name}</strong>
              <small>
                {q.code}
                {q.grantsMedication ? " · berechtigt zur Medikation" : ""}
              </small>
              {on && <ModuleIcon name="check" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
