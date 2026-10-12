"use client";

import { useState } from "react";
import { ModuleIcon } from "./module-icon";
import type { WorkContext } from "@/lib/work-context";
import { initials } from "./header-parts";

export function ProfilePopover({
  context,
  onClose,
  onSave,
}: {
  context: WorkContext | null;
  onClose: () => void;
  onSave: (data: WorkContext) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [jobTitle, setJobTitle] = useState(context?.profile.jobTitle ?? "");
  const [phone, setPhone] = useState(context?.profile.phone ?? "");
  const [primaryCareUnitId, setPrimaryCareUnitId] = useState(context?.profile.primaryCareUnitId ?? "");
  const [saving, setSaving] = useState(false);
  const profile = context?.profile;
  if (!context || !profile) return null;
  async function saveProfile() {
    if (!primaryCareUnitId) return;
    setSaving(true);
    try {
      const response = await fetch("/api/work-context", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobTitle, phone, primaryCareUnitId }),
      });
      if (!response.ok) throw new Error();
      onSave((await response.json()) as WorkContext);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }
  const valueField = (label: string, value: string, setValue: (value: string) => void) =>
    editing ? (
      <label className="profile-edit-field">
        <span>{label}</span>
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
    ) : (
      <div className="profile-read-field">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    );
  return (
    <div
      className="profile-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section className="profile-panel" role="dialog" aria-modal="true" aria-labelledby="profile-popover-title">
        <header className="profile-panel-header">
          <div>
            <p className="eyebrow">CareOS · Persönlicher Bereich</p>
            <h2 id="profile-popover-title">Mein Profil</h2>
            <p>Verwalte deine persönlichen Angaben und deinen festen Arbeitsbereich.</p>
          </div>
          <button className="profile-panel-close" type="button" onClick={onClose} aria-label="Profil schliessen">
            <ModuleIcon name="close" />
          </button>
        </header>
        <div className="profile-panel-body">
          <div className="profile-panel-layout">
            <aside className="profile-summary-card">
              <span className="profile-large-avatar">{initials(profile.displayName)}</span>
              <p className="eyebrow">Fester Arbeitsplatz</p>
              <h3>{profile.displayName}</h3>
              <p>{profile.jobTitle}</p>
              <span className="status-badge stable">Profil aktiv</span>
              <div className="profile-summary-meta">
                <span>
                  <ModuleIcon name="building" /> {profile.organizationName}
                </span>
                <span>
                  <ModuleIcon name="calendar" /> {profile.primaryCareUnitName ?? "Noch nicht festgelegt"}
                </span>
              </div>
            </aside>
            <section className="card profile-details-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Ausgewählt</p>
                  <h2 className="card-title">Persönliche Angaben</h2>
                  <p className="card-subtitle">
                    Der feste Wohnbereich wird in deinem Benutzerprofil und in der Datenbank hinterlegt.
                  </p>
                </div>
                <div className="profile-detail-actions">
                  {editing && (
                    <button className="secondary-button" type="button" onClick={() => setEditing(false)}>
                      Abbrechen
                    </button>
                  )}
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => (editing ? void saveProfile() : setEditing(true))}
                    disabled={saving}
                  >
                    <ModuleIcon name={editing ? "check" : "note"} />
                    {saving ? "Speichern…" : editing ? "Speichern" : "Bearbeiten"}
                  </button>
                </div>
              </div>
              <div className="profile-fields-grid">
                <div className="profile-read-field">
                  <span>Vollständiger Name</span>
                  <strong>{profile.displayName}</strong>
                </div>
                {valueField("Funktion", jobTitle, setJobTitle)}
                <div className="profile-read-field">
                  <span>Organisation</span>
                  <strong>{profile.organizationName}</strong>
                </div>
                {valueField("Telefon", phone, setPhone)}
                <div className="profile-read-field profile-read-field-wide">
                  <span>Fester Wohnbereich</span>
                  {editing ? (
                    <div className="profile-unit-options" role="radiogroup" aria-label="Festen Wohnbereich wählen">
                      {context.careUnits.map((unit) => (
                        <button
                          className={primaryCareUnitId === unit.id ? "active" : ""}
                          type="button"
                          role="radio"
                          aria-checked={primaryCareUnitId === unit.id}
                          key={unit.id}
                          onClick={() => setPrimaryCareUnitId(unit.id)}
                        >
                          <span>
                            <strong>{unit.name}</strong>
                            <small>{unit.detail}</small>
                          </span>
                          {primaryCareUnitId === unit.id && <ModuleIcon name="check" />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <strong>{profile.primaryCareUnitName ?? "Noch nicht festgelegt"}</strong>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
