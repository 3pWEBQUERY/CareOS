"use client";

import { useState } from "react";
import { EditorDialog } from "@/app/components/workspace-ui";
import type { SettingsPayload } from "@/lib/roster/settings-service";
import { formatDate } from "@/lib/roster/time";
import { WEEKDAY_SHORT, type ShiftTypeInfo } from "@/lib/roster/types";
import { rosterRequest } from "./roster-api";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import { act, type TabProps } from "./settings-tab-shared";

// --- Mindestbesetzung ----------------------------------------------------------------------------

export function StaffingTab({ data, reload, showToast }: TabProps) {
  const types = data.shiftTypes.filter((t) => t.category !== "ABSENCE" && t.active);
  const [editing, setEditing] = useState<ShiftTypeInfo | null>(null);
  const [exception, setException] = useState({ date: "", shiftTypeId: types[0]?.id ?? "", minCount: 1, maxCount: "" });
  const cell = (typeId: string, weekday: number) =>
    data.staffing.find((s) => s.shiftTypeId === typeId && s.weekday === weekday);
  const exceptions = data.staffing.filter((s) => s.date);
  if (!data.unitId) return <p className="roster-muted">Kein Wohnbereich gewählt.</p>;
  return (
    <>
      <section className="card roster-card">
        <div className="roster-section-head">
          <div>
            <h2>Mindestbesetzung je Wochentag</h2>
            <p>
              Mindestens / höchstens Personen je Diensttyp. Unterbesetzung ist im Entwurf eine Warnung und muss beim
              Veröffentlichen bestätigt werden.
            </p>
          </div>
        </div>
        <div className="roster-table-wrap">
          <table className="roster-table">
            <thead>
              <tr>
                <th>Diensttyp</th>
                {WEEKDAY_SHORT.map((day) => (
                  <th key={day} className="number">
                    {day}
                  </th>
                ))}
                <th>Fachpersonen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {types.map((type) => {
                const qualified = data.staffing.find((s) => s.shiftTypeId === type.id && s.qualificationId && !s.date);
                return (
                  <tr key={type.id}>
                    <td>
                      <span className="roster-type-dot" style={{ background: type.color }} />{" "}
                      <strong>{type.code}</strong> {type.name}
                    </td>
                    {WEEKDAY_SHORT.map((day, index) => {
                      const value = cell(type.id, index + 1);
                      return (
                        <td key={day} className="number">
                          {value ? `${value.minCount}${value.maxCount !== null ? `–${value.maxCount}` : "+"}` : "–"}
                        </td>
                      );
                    })}
                    <td>
                      {qualified
                        ? `mind. ${qualified.minQualified} ${data.qualifications.find((q) => q.id === qualified.qualificationId)?.code ?? ""}`
                        : "–"}
                    </td>
                    <td>
                      <button className="secondary-button" type="button" onClick={() => setEditing(type)}>
                        Bearbeiten
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card roster-card">
        <div className="roster-section-head">
          <div>
            <h2>Ausnahmen für einzelne Tage</h2>
            <p>Ein Datum überschreibt die Vorgabe des Wochentags (z. B. Festtag, Ausflug).</p>
          </div>
        </div>
        <div className="roster-form-grid">
          <label>
            Datum
            <CareDatePicker
              label="Datum"
              value={exception.date}
              onChange={(value) => setException({ ...exception, date: value })}
            />
          </label>
          <label>
            Diensttyp
            <CareOptionSelect
              label="Diensttyp"
              value={exception.shiftTypeId}
              onChange={(value) => setException({ ...exception, shiftTypeId: value })}
              options={[...types.map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` }))]}
            />
          </label>
          <label>
            Mindestens
            <input
              type="number"
              min={0}
              max={50}
              value={exception.minCount}
              onChange={(e) => setException({ ...exception, minCount: Number(e.target.value) })}
            />
          </label>
          <label>
            Höchstens (optional)
            <input
              type="number"
              min={0}
              max={50}
              value={exception.maxCount}
              onChange={(e) => setException({ ...exception, maxCount: e.target.value })}
            />
          </label>
        </div>
        <div className="roster-form-actions">
          <button
            className="primary-button"
            type="button"
            disabled={!exception.date}
            onClick={() =>
              void act(
                () =>
                  rosterRequest("/api/dienstplan/settings/staffing", {
                    method: "POST",
                    body: {
                      unitId: data.unitId,
                      shiftTypeId: exception.shiftTypeId,
                      date: exception.date,
                      minCount: exception.minCount,
                      maxCount: exception.maxCount || null,
                    },
                  }),
                "Ausnahme gespeichert",
                reload,
                showToast,
              )
            }
          >
            Ausnahme speichern
          </button>
        </div>
        {exceptions.length > 0 && (
          <div className="roster-table-wrap">
            <table className="roster-table">
              <tbody>
                {exceptions.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDate(s.date!, true)}</td>
                    <td>{types.find((t) => t.id === s.shiftTypeId)?.name ?? "Diensttyp"}</td>
                    <td className="number">
                      {s.minCount}
                      {s.maxCount !== null ? `–${s.maxCount}` : "+"}
                    </td>
                    <td>
                      <button
                        className="appointment-danger-button"
                        type="button"
                        onClick={() =>
                          void act(
                            () => rosterRequest(`/api/dienstplan/settings/staffing/${s.id}`, { method: "DELETE" }),
                            "Ausnahme gelöscht",
                            reload,
                            showToast,
                          )
                        }
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && (
        <StaffingEditor
          data={data}
          type={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            showToast("Mindestbesetzung gespeichert");
            reload();
          }}
        />
      )}
    </>
  );
}

function StaffingEditor({
  data,
  type,
  onClose,
  onSaved,
}: {
  data: SettingsPayload;
  type: ShiftTypeInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = (weekday: number) => data.staffing.find((s) => s.shiftTypeId === type.id && s.weekday === weekday);
  const qualified = data.staffing.find((s) => s.shiftTypeId === type.id && s.qualificationId && !s.date);
  const [rows, setRows] = useState(
    WEEKDAY_SHORT.map((_, index) => ({
      min: existing(index + 1)?.minCount?.toString() ?? "",
      max: existing(index + 1)?.maxCount?.toString() ?? "",
    })),
  );
  const [qualificationId, setQualificationId] = useState(qualified?.qualificationId ?? "");
  const [minQualified, setMinQualified] = useState(qualified?.minQualified ?? 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      for (const [index, row] of rows.entries()) {
        const current = existing(index + 1);
        if (row.min === "") {
          if (current) await rosterRequest(`/api/dienstplan/settings/staffing/${current.id}`, { method: "DELETE" });
          continue;
        }
        await rosterRequest("/api/dienstplan/settings/staffing", {
          method: "POST",
          body: {
            unitId: data.unitId,
            shiftTypeId: type.id,
            weekday: index + 1,
            minCount: Number(row.min),
            maxCount: row.max === "" ? null : Number(row.max),
            qualificationId: qualificationId || null,
            minQualified: qualificationId ? minQualified : null,
          },
        });
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="roster-staffing"
      eyebrow="Dienstplan · Mindestbesetzung"
      title={`${type.code} · ${type.name}`}
      description="Leer lassen = keine Vorgabe für diesen Wochentag."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      {WEEKDAY_SHORT.map((day, index) => (
        <fieldset key={day}>
          <legend>{day}</legend>
          <div className="roster-row-actions">
            <input
              className="roster-inline-input"
              type="number"
              min={0}
              max={50}
              placeholder="min"
              aria-label={`${day} mindestens`}
              value={rows[index].min}
              onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, min: e.target.value } : r)))}
            />
            <input
              className="roster-inline-input"
              type="number"
              min={0}
              max={50}
              placeholder="max"
              aria-label={`${day} höchstens`}
              value={rows[index].max}
              onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, max: e.target.value } : r)))}
            />
          </div>
        </fieldset>
      ))}
      <label>
        <span>Mindestens qualifiziert (optional)</span>
        <CareOptionSelect
          label="Mindestens qualifiziert"
          value={qualificationId}
          onChange={(value) => setQualificationId(value)}
          options={[
            { value: "", label: "keine Vorgabe" },
            ...data.qualifications.map((q) => ({ value: String(q.id), label: String(q.name) })),
          ]}
        />
      </label>
      {qualificationId && (
        <label>
          <span>Anzahl</span>
          <input
            type="number"
            min={1}
            max={50}
            value={minQualified}
            onChange={(e) => setMinQualified(Number(e.target.value))}
          />
        </label>
      )}
    </EditorDialog>
  );
}
