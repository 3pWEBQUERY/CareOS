"use client";

import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { TeamleadRow, Unit, initials, labelRole } from "./teamlead-utils";

export function TeamleadEmployeeEditor({
  employee,
  units,
  onClose,
  onUpdated,
}: {
  employee: TeamleadRow;
  units: Unit[];
  onClose: () => void;
  onUpdated: (message: string) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(employee.display_name);
  const [username, setUsername] = useState(employee.username ?? "");
  const [role, setRole] = useState(employee.role);
  const [jobTitle, setJobTitle] = useState(employee.job_title ?? "");
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [unitId, setUnitId] = useState(employee.primary_care_unit_id ?? "");
  const [mode, setMode] = useState<"edit" | "archive" | "delete">("edit");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const unitName = units.find((unit) => unit.id === unitId)?.name ?? "Nicht festgelegt";
  const roleOptions = ["Mitarbeitende:r", "Pflege", "Ärztlicher Dienst", "Leitung"];
  const roleKey = (value: string) =>
    ({ "Mitarbeitende:r": "mitarbeitende:r", Pflege: "pflege", "Ärztlicher Dienst": "arzt", Leitung: "leitung" })[
      value
    ] ?? "mitarbeitende:r";

  async function request(method: "PATCH" | "DELETE", payload: Record<string, string | null>) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/teamlead/employees", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: employee.id, ...payload }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Die Änderung konnte nicht gespeichert werden.");
      await onUpdated(
        method === "DELETE"
          ? "Mitarbeiter wurde endgültig gelöscht."
          : payload.action === "archive"
            ? "Mitarbeiter wurde archiviert."
            : payload.action === "restore"
              ? "Mitarbeiter wurde wiederhergestellt."
              : "Mitarbeiterprofil wurde gespeichert.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Änderung konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="user-editor-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="user-editor-panel" role="dialog" aria-modal="true" aria-labelledby="teamlead-employee-title">
        <header className="user-editor-header">
          <div>
            <p className="eyebrow">Teamleitung · Mitarbeitende</p>
            <h2 id="teamlead-employee-title">{employee.display_name} verwalten</h2>
            <p>Profil, Rolle und Arbeitsbereich werden nachvollziehbar im Änderungsprotokoll gespeichert.</p>
          </div>
          <button
            className="profile-panel-close"
            type="button"
            onClick={onClose}
            aria-label="Mitarbeiterverwaltung schliessen"
          >
            ×
          </button>
        </header>
        <div className="user-editor-body">
          <aside className="user-editor-summary">
            <span className="profile-large-avatar">{initials(displayName || employee.display_name)}</span>
            <h3>{displayName || employee.display_name}</h3>
            <p>@{username || employee.username}</p>
            <div className="user-editor-actions">
              <button className={mode === "edit" ? "active" : ""} type="button" onClick={() => setMode("edit")}>
                Profil bearbeiten
              </button>
              <button
                className={mode === "archive" ? "active warning" : "warning"}
                type="button"
                onClick={() => setMode("archive")}
              >
                {employee.active ? "Sperren & archivieren" : "Wiederherstellen"}
              </button>
              <button
                className={mode === "delete" ? "active danger" : "danger"}
                type="button"
                onClick={() => setMode("delete")}
              >
                Endgültig löschen
              </button>
            </div>
          </aside>
          <section className="user-editor-content">
            {mode === "edit" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void request("PATCH", {
                    displayName,
                    username,
                    role,
                    jobTitle,
                    phone,
                    primaryCareUnitId: unitId || null,
                  });
                }}
              >
                <div className="user-editor-section-heading">
                  <p className="eyebrow">Profil und Berechtigungen</p>
                  <h3>Mitarbeiterprofil</h3>
                  <p>Aktualisiere die Angaben für die tägliche Zusammenarbeit im Team.</p>
                </div>
                <div className="user-editor-fields">
                  <label>
                    Name
                    <input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                  </label>
                  <label>
                    Benutzername
                    <input
                      required
                      value={username}
                      onChange={(event) => setUsername(event.target.value.replace(/\s/g, ""))}
                    />
                  </label>
                  <label>
                    Funktion
                    <input
                      value={jobTitle}
                      placeholder="z. B. Pflegefachperson HF"
                      onChange={(event) => setJobTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    Telefon
                    <input
                      value={phone}
                      placeholder="z. B. +41 79 123 45 67"
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  </label>
                  <label>
                    Rolle
                    <CareSelect
                      label="Rolle auswählen"
                      value={labelRole(role)}
                      options={roleOptions}
                      onChange={(value) => setRole(roleKey(value))}
                    />
                  </label>
                  <label>
                    Fester Arbeitsbereich
                    <CareSelect
                      label="Festen Arbeitsbereich auswählen"
                      value={unitName}
                      options={["Nicht festgelegt", ...units.map((unit) => unit.name)]}
                      onChange={(name) => setUnitId(units.find((unit) => unit.name === name)?.id ?? "")}
                    />
                  </label>
                </div>
                {error && <p className="user-editor-error">{error}</p>}
                <footer className="user-editor-footer">
                  <button className="primary-button" disabled={saving}>
                    Änderungen speichern
                  </button>
                </footer>
              </form>
            ) : (
              <div className="user-editor-confirm">
                <p className="eyebrow">{mode === "delete" ? "Irreversible Aktion" : "Kontostatus"}</p>
                <h3>
                  {mode === "delete"
                    ? "Mitarbeiter endgültig löschen"
                    : employee.active
                      ? "Mitarbeiter archivieren"
                      : "Mitarbeiter wiederherstellen"}
                </h3>
                <p>
                  {mode === "delete"
                    ? "Das Mitarbeiterkonto wird inklusive Zugang dauerhaft entfernt."
                    : employee.active
                      ? "Das Profil wird aus dem Tagesgeschäft entfernt und als Archiv geführt."
                      : "Das Profil wird wieder aktiviert und steht dem Team wieder zur Verfügung."}
                </p>
                {error && <p className="user-editor-error">{error}</p>}
                <div className="user-editor-footer">
                  <button className="secondary-button" type="button" onClick={() => setMode("edit")}>
                    Abbrechen
                  </button>
                  <button
                    className={mode === "delete" || employee.active ? "danger-button" : "primary-button"}
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void request(
                        mode === "delete" ? "DELETE" : "PATCH",
                        mode === "delete" ? {} : { action: employee.active ? "archive" : "restore" },
                      )
                    }
                  >
                    {mode === "delete" ? "Endgültig löschen" : employee.active ? "Archivieren" : "Wiederherstellen"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
