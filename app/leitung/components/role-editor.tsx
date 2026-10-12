"use client";

import { useCountry, useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { EditorDialog } from "@/app/components/workspace-ui";
import type { ManagedRole } from "@/lib/admin-users";
import { permissionHints, permissionLabel, permissions } from "./admin-user-parts";

// Interne Kennung einer neuen Rolle aus dem Namen (nicht sichtbar); der Zusatz hält sie eindeutig.
function roleKey(name: string) {
  const base = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${base || "rolle"}-${Date.now().toString(36).slice(-6)}`;
}

function Choice({
  active,
  disabled,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`role-permission ${active ? "active" : ""}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="role-permission-box" aria-hidden="true">
        {active && <ModuleIcon name="check" />}
      </span>
      <span className="role-permission-text">
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
    </button>
  );
}

export function RoleEditor({
  role,
  onClose,
  onUpdated,
}: {
  role: ManagedRole | null;
  onClose: () => void;
  onUpdated: (roles: ManagedRole[], message: string) => void;
}) {
  const t = useTerms();
  const country = useCountry();
  const [name, setName] = useState(role?.name ?? ""),
    [description, setDescription] = useState(role?.description ?? ""),
    [selected, setSelected] = useState<string[]>(role?.permissions ?? []),
    [needsQualification, setNeedsQualification] = useState(role?.medicationRequiresQualification ?? false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    // Kopie: dieselben Rechte als neue eigene Rolle der Einrichtung.
    [copyOf, setCopyOf] = useState<ManagedRole | null>(null);
  const editing = copyOf ? null : role;
  const toggle = (v: string) =>
    setSelected((items) => (items.includes(v) ? items.filter((x) => x !== v) : [...items, v]));
  async function request(method: "POST" | "PATCH" | "DELETE") {
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/admin/roles", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          method === "DELETE"
            ? { roleId: role?.id }
            : editing
              ? {
                  roleId: editing.id,
                  name,
                  description,
                  permissions: selected,
                  medicationRequiresQualification: needsQualification,
                }
              : {
                  name,
                  key: roleKey(name),
                  description,
                  permissions: selected,
                  medicationRequiresQualification: needsQualification,
                  copyOf: copyOf?.id,
                },
        ),
      });
      const payload = (await r.json()) as { roles?: ManagedRole[]; error?: string };
      if (!r.ok || !payload.roles) throw new Error(payload.error);
      onUpdated(
        payload.roles,
        method === "DELETE"
          ? "Rolle gelöscht"
          : editing
            ? "Rolle gespeichert"
            : copyOf
              ? "Rolle kopiert"
              : "Rolle erstellt",
      );
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Rolle konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }
  const medication =
    (selected.includes("medication.manage") || selected.includes("medication.administer")) &&
    editing?.key !== "admin" &&
    editing?.key !== "leitung";
  return (
    <EditorDialog
      id="role"
      eyebrow="Administration · Rollen & Berechtigungen"
      title={editing ? `${editing.name} verwalten` : copyOf ? `${copyOf.name} kopieren` : "Rolle erstellen"}
      description={
        copyOf
          ? `Die Kopie übernimmt die Berechtigungen von „${copyOf.name}“ und gehört nur dieser Einrichtung.`
          : editing?.systemRole
            ? "Systemrolle: Name und Berechtigungen lassen sich anpassen, die Rolle selbst bleibt bestehen."
            : "Eigene Rollen der Einrichtung lassen sich entfernen, solange sie niemandem zugeordnet sind."
      }
      onClose={onClose}
      onSubmit={() => request(editing ? "PATCH" : "POST")}
      saving={saving}
      error={error}
      submitLabel="Rolle speichern"
      extraActions={
        editing ? (
          <>
            {!editing.systemRole && (
              <button
                className="appointment-danger-button"
                type="button"
                disabled={saving || editing.userCount > 0}
                title={editing.userCount > 0 ? "Die Rolle ist noch Mitarbeitenden zugeordnet." : undefined}
                onClick={() => void request("DELETE")}
              >
                Rolle löschen
              </button>
            )}
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => {
                setCopyOf(editing);
                setName(`${editing.name} (Kopie)`.slice(0, 100));
                setError("");
              }}
            >
              Rolle kopieren
            </button>
          </>
        ) : undefined
      }
    >
      <label>
        <span>Name</span>
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <span>Beschreibung (optional)</span>
        <input
          maxLength={500}
          value={description}
          placeholder="z. B. Pflege im Nachtdienst"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <fieldset className="area-editor-wide role-permissions">
        <legend>
          Berechtigungen <span>{selected.length ? `${selected.length} gewählt` : "keine gewählt"}</span>
        </legend>
        <div role="group" aria-label="Berechtigungen">
          {permissions.map((p) => (
            <Choice
              key={p}
              active={selected.includes(p)}
              // Die Leitung verabreicht Medikamente immer.
              disabled={editing?.key === "leitung" && p === "medication.administer"}
              title={permissionLabel(p, t)}
              hint={permissionHints[p] ?? ""}
              onClick={() => toggle(p)}
            />
          ))}
        </div>
      </fieldset>
      {medication && (
        <fieldset className="area-editor-wide role-permissions">
          <legend>Medikation</legend>
          <div>
            <Choice
              active={needsQualification}
              title="Nur mit Qualifikation"
              hint={`Medikation nur für Personen mit berechtigender Qualifikation (z. B. ${country.medicationExamples})`}
              onClick={() => setNeedsQualification((value) => !value)}
            />
          </div>
        </fieldset>
      )}
    </EditorDialog>
  );
}
