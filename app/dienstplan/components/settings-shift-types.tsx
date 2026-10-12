"use client";

import { useState } from "react";
import { EditorDialog } from "@/app/components/workspace-ui";
import type { SettingsPayload } from "@/lib/roster/settings-service";
import {
  ABSENCE_LABELS,
  CATEGORY_LABELS,
  type AbsenceKind,
  type ShiftCategory,
  type ShiftTypeInfo,
} from "@/lib/roster/types";
import { rosterRequest } from "./roster-api";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { act, type TabProps } from "./settings-tab-shared";

// --- Diensttypen ---------------------------------------------------------------------------------

export function ShiftTypesTab({ data, reload, showToast }: TabProps) {
  const [editing, setEditing] = useState<(ShiftTypeInfo & { used?: boolean }) | "new" | null>(null);
  const qualification = (id: string) => data.qualifications.find((q) => q.id === id)?.code ?? "?";
  return (
    <section className="card roster-card">
      <div className="roster-section-head">
        <div>
          <h2>Diensttypen</h2>
          <p>
            Diensttypen mit Diensten werden deaktiviert statt gelöscht. Farben erscheinen immer zusammen mit dem Kürzel.
          </p>
        </div>
        <button className="primary-button" type="button" onClick={() => setEditing("new")}>
          Diensttyp hinzufügen
        </button>
      </div>
      <div className="roster-table-wrap">
        <table className="roster-table">
          <thead>
            <tr>
              <th>Kürzel</th>
              <th>Name</th>
              <th>Kategorie</th>
              <th>Zeiten</th>
              <th className="number">Pause</th>
              <th className="number">Anrechnung</th>
              <th>Qualifikation</th>
              <th>Gültig für</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.shiftTypes.map((type) => (
              <tr key={type.id}>
                <td>
                  <span className="roster-type-dot" style={{ background: type.color }} /> <strong>{type.code}</strong>
                </td>
                <td>{type.name}</td>
                <td>
                  {CATEGORY_LABELS[type.category]}
                  {type.absenceKind ? ` · ${ABSENCE_LABELS[type.absenceKind]}` : ""}
                </td>
                <td>
                  {type.startTime}–{type.endTime}
                  {type.endTime <= type.startTime ? " (+1)" : ""}
                </td>
                <td className="number">{type.breakMinutes} Min</td>
                <td className="number">
                  {type.category === "ABSENCE"
                    ? type.creditsTarget
                      ? "Tagessoll"
                      : "keine"
                    : `${Math.round(type.workTimeFactor * 100)} %`}
                </td>
                <td>{type.requiredQualificationIds.map(qualification).join(", ") || "–"}</td>
                <td>
                  {type.careUnitId
                    ? (data.units.find((u) => u.id === type.careUnitId)?.name ?? "Wohnbereich")
                    : "Organisation"}
                </td>
                <td>
                  <span className={`roster-pill ${type.active ? "ok" : ""}`}>{type.active ? "aktiv" : "inaktiv"}</span>
                </td>
                <td>
                  <div className="roster-row-actions">
                    <button className="secondary-button" type="button" onClick={() => setEditing(type)}>
                      Bearbeiten
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        void act(
                          () =>
                            rosterRequest(`/api/dienstplan/settings/shift-types/${type.id}`, {
                              method: "PATCH",
                              body: { active: !type.active },
                            }),
                          type.active ? "Diensttyp deaktiviert" : "Diensttyp aktiviert",
                          reload,
                          showToast,
                        )
                      }
                    >
                      {type.active ? "Deaktivieren" : "Aktivieren"}
                    </button>
                    {!type.used && (
                      <button
                        className="appointment-danger-button"
                        type="button"
                        onClick={() =>
                          window.confirm(`Diensttyp „${type.name}“ löschen?`) &&
                          void act(
                            () =>
                              rosterRequest(`/api/dienstplan/settings/shift-types/${type.id}`, { method: "DELETE" }),
                            "Diensttyp gelöscht",
                            reload,
                            showToast,
                          )
                        }
                      >
                        Löschen
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <ShiftTypeEditor
          data={data}
          type={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            showToast(message);
            reload();
          }}
        />
      )}
    </section>
  );
}

function ShiftTypeEditor({
  data,
  type,
  onClose,
  onSaved,
}: {
  data: SettingsPayload;
  type: ShiftTypeInfo | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: type?.name ?? "",
    code: type?.code ?? "",
    category: (type?.category ?? "WORK") as ShiftCategory,
    absenceKind: (type?.absenceKind ?? "VACATION") as AbsenceKind,
    startTime: type?.startTime ?? "07:00",
    endTime: type?.endTime ?? "15:30",
    breakMinutes: type?.breakMinutes ?? 30,
    color: type?.color ?? "#2563eb",
    workTimeFactor: type?.workTimeFactor ?? 1,
    creditsTarget: type?.creditsTarget ?? false,
    requiredQualificationIds: type?.requiredQualificationIds ?? [],
    sortOrder: type?.sortOrder ?? 100,
    scope: type ? (type.careUnitId ?? "org") : data.isAdmin ? "org" : (data.unitId ?? "org"),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const body = { ...form, unitId: form.scope === "org" ? null : form.scope };
      if (type) await rosterRequest(`/api/dienstplan/settings/shift-types/${type.id}`, { method: "PATCH", body });
      else await rosterRequest("/api/dienstplan/settings/shift-types", { method: "POST", body });
      onSaved(type ? "Diensttyp gespeichert" : "Diensttyp angelegt");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="roster-type"
      eyebrow="Dienstplan · Einstellungen"
      title={type ? `${type.code} · ${type.name}` : "Diensttyp hinzufügen"}
      description="Endet ein Dienst vor oder zu seiner Beginnzeit, endet er am Folgetag (z. B. Nachtdienst)."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label>
        <span>Name</span>
        <input value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} required />
      </label>
      <label>
        <span>Kürzel (max. 8)</span>
        <input value={form.code} maxLength={8} onChange={(e) => set("code", e.target.value.toUpperCase())} required />
      </label>
      <label>
        <span>Kategorie</span>
        <CareOptionSelect
          label="Kategorie"
          value={form.category}
          onChange={(value) => set("category", value as ShiftCategory)}
          options={[
            ...(Object.keys(CATEGORY_LABELS) as ShiftCategory[]).map((key) => ({
              value: String(key),
              label: String(CATEGORY_LABELS[key]),
            })),
          ]}
        />
      </label>
      {form.category === "ABSENCE" ? (
        <label>
          <span>Art der Abwesenheit</span>
          <CareOptionSelect
            label="Art der Abwesenheit"
            value={form.absenceKind}
            onChange={(value) => set("absenceKind", value as AbsenceKind)}
            options={[
              ...(Object.keys(ABSENCE_LABELS) as AbsenceKind[]).map((key) => ({
                value: String(key),
                label: String(ABSENCE_LABELS[key]),
              })),
            ]}
          />
        </label>
      ) : (
        <label>
          <span>Anrechnung auf die Arbeitszeit (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round(form.workTimeFactor * 100)}
            onChange={(e) => set("workTimeFactor", Number(e.target.value) / 100)}
          />
        </label>
      )}
      <label>
        <span>Beginn</span>
        <input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
      </label>
      <label>
        <span>Ende</span>
        <input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
      </label>
      <label>
        <span>Pause (Minuten)</span>
        <input
          type="number"
          min={0}
          max={240}
          value={form.breakMinutes}
          onChange={(e) => set("breakMinutes", Number(e.target.value))}
        />
      </label>
      <label>
        <span>Farbe</span>
        <input type="color" value={form.color} onChange={(e) => set("color", e.target.value)} />
      </label>
      {form.category === "ABSENCE" && (
        <label className="area-editor-wide roster-checkbox">
          <input
            type="checkbox"
            checked={form.creditsTarget}
            onChange={(e) => set("creditsTarget", e.target.checked)}
          />
          <span>Wird mit dem Tagessoll auf die Sollzeit angerechnet (z. B. Urlaub, Krankheit)</span>
        </label>
      )}
      {form.category !== "ABSENCE" && (
        <fieldset className="area-editor-wide">
          <legend>Erforderliche Qualifikation</legend>
          <div className="roster-chips-select">
            {data.qualifications.map((q) => (
              <label className="roster-checkbox" key={q.id}>
                <input
                  type="checkbox"
                  checked={form.requiredQualificationIds.includes(q.id)}
                  onChange={(e) =>
                    set(
                      "requiredQualificationIds",
                      e.target.checked
                        ? [...form.requiredQualificationIds, q.id]
                        : form.requiredQualificationIds.filter((id) => id !== q.id),
                    )
                  }
                />
                <span>{q.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!type && (
        <label>
          <span>Gültig für</span>
          <CareOptionSelect
            label="Gültig für"
            value={form.scope}
            onChange={(value) => set("scope", value)}
            options={[
              ...(data.isAdmin ? [{ value: "org", label: "Ganze Organisation" }] : []),
              ...data.units.map((unit) => ({ value: String(unit.id), label: `Nur ${unit.name}` })),
            ]}
          />
        </label>
      )}
      <label>
        <span>Reihenfolge</span>
        <input
          type="number"
          min={0}
          max={1000}
          value={form.sortOrder}
          onChange={(e) => set("sortOrder", Number(e.target.value))}
        />
      </label>
    </EditorDialog>
  );
}
