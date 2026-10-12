"use client";

import { useState } from "react";
import { CareDatePicker } from "@/app/components/care-form-controls";
import { EditorDialog } from "@/app/components/workspace-ui";
import type { SettingsPayload } from "@/lib/roster/settings-service";
import { formatDate } from "@/lib/roster/time";
import { EXCLUSION_LABELS, type ExclusionCategory } from "@/lib/roster/types";
import { rosterRequest } from "./roster-api";
import { act, type TabProps } from "./settings-tab-shared";

// --- Personal ------------------------------------------------------------------------------------

type Person = SettingsPayload["employees"][number];

export function PeopleTab({ data, reload, showToast }: TabProps) {
  const [editing, setEditing] = useState<Person | null>(null);
  const [qualification, setQualification] = useState({ code: "", name: "", grantsMedication: false });
  const qualificationCodes = (person: Person) =>
    person.qualifications
      .map((q) => data.qualifications.find((x) => x.id === q.qualificationId)?.code ?? "?")
      .join(", ") || "–";
  return (
    <>
      <section className="card roster-card">
        <div className="roster-section-head">
          <div>
            <h2>Personal im Wohnbereich</h2>
            <p>
              Pensum, Anstellung, Wohnbereiche (Springer), Leitung, Qualifikationen und ausgeschlossene Dienste – ohne
              Angabe von Gründen.
            </p>
          </div>
        </div>
        <div className="roster-table-wrap">
          <table className="roster-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="number">Pensum</th>
                <th>Anstellung</th>
                <th>Qualifikation</th>
                <th>Nicht einplanbar für</th>
                <th>Wohnbereiche</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.employees.map((person) => (
                <tr key={person.id}>
                  <td>
                    <strong>{person.name}</strong>{" "}
                    {!person.active && <span className="roster-pill attention">inaktiv</span>}
                  </td>
                  <td className="number">{person.pensumPercent} %</td>
                  <td>
                    {person.employmentStart ? formatDate(person.employmentStart, true) : "–"} bis{" "}
                    {person.employmentEnd ? formatDate(person.employmentEnd, true) : "offen"}
                  </td>
                  <td>{qualificationCodes(person)}</td>
                  <td>
                    {person.excludedCategories.map((c) => EXCLUSION_LABELS[c as ExclusionCategory]).join(", ") || "–"}
                  </td>
                  <td>
                    {person.unitIds
                      .map((id) => data.units.find((u) => u.id === id)?.name ?? "anderer Bereich")
                      .join(", ")}
                  </td>
                  <td>
                    <button className="secondary-button" type="button" onClick={() => setEditing(person)}>
                      Bearbeiten
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card roster-card">
        <div className="roster-section-head">
          <div>
            <h2>Qualifikationen</h2>
            <p>
              {data.qualifications
                .map((q) => `${q.code} (${q.name}${q.grantsMedication ? ", Medikation" : ""})`)
                .join(" · ")}
            </p>
          </div>
        </div>
        <div className="roster-form-grid">
          <label>
            Kürzel
            <input
              value={qualification.code}
              maxLength={24}
              onChange={(e) => {
                // Bekanntes Kürzel: Bezeichnung und Medikationsrecht übernehmen, damit nichts unbemerkt zurückgesetzt wird.
                const known = data.qualifications.find((q) => q.code === e.target.value.trim().toUpperCase());
                setQualification(
                  known
                    ? { code: e.target.value, name: known.name, grantsMedication: known.grantsMedication }
                    : { ...qualification, code: e.target.value },
                );
              }}
            />
          </label>
          <label>
            Bezeichnung
            <input
              value={qualification.name}
              maxLength={120}
              onChange={(e) => setQualification({ ...qualification, name: e.target.value })}
            />
          </label>
          <label className="area-editor-wide roster-checkbox">
            <input
              type="checkbox"
              checked={qualification.grantsMedication}
              onChange={(e) => setQualification({ ...qualification, grantsMedication: e.target.checked })}
            />
            <span>Berechtigt zur Medikation (Rollen wie „Pflege“ erhalten das Medikationsrecht nur damit)</span>
          </label>
        </div>
        <div className="roster-form-actions">
          <button
            className="primary-button"
            type="button"
            disabled={!qualification.code.trim() || !qualification.name.trim()}
            onClick={() =>
              void act(
                () => rosterRequest("/api/dienstplan/settings/qualifications", { method: "POST", body: qualification }),
                "Qualifikation gespeichert",
                reload,
                showToast,
              ).then(() => setQualification({ code: "", name: "", grantsMedication: false }))
            }
          >
            Qualifikation speichern
          </button>
        </div>
      </section>
      {editing && (
        <PersonEditor
          data={data}
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            showToast("Personalprofil gespeichert");
            reload();
          }}
        />
      )}
    </>
  );
}

function PersonEditor({
  data,
  person,
  onClose,
  onSaved,
}: {
  data: SettingsPayload;
  person: Person;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    employeeNumber: person.employeeNumber,
    pensumPercent: person.pensumPercent,
    employmentStart: person.employmentStart ?? "",
    employmentEnd: person.employmentEnd ?? "",
    active: person.active,
    excludedCategories: person.excludedCategories,
    unitIds: person.unitIds,
    leadUnitIds: person.leadUnitIds,
    qualifications: person.qualifications,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toggle = (list: string[], value: string, on: boolean) =>
    on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await rosterRequest(`/api/dienstplan/settings/employees/${person.id}`, {
        method: "PATCH",
        body: { ...form, employmentStart: form.employmentStart || null, employmentEnd: form.employmentEnd || null },
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="roster-person"
      eyebrow="Dienstplan · Personal"
      title={person.name}
      description="Gründe für Einschränkungen werden bewusst nicht gespeichert."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label>
        <span>Pensum (%)</span>
        <input
          type="number"
          min={1}
          max={100}
          value={form.pensumPercent}
          onChange={(e) => setForm({ ...form, pensumPercent: Number(e.target.value) })}
        />
      </label>
      <label>
        <span>Personalnummer (Lohn)</span>
        <input
          maxLength={80}
          value={form.employeeNumber}
          onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })}
        />
      </label>
      <label className="roster-checkbox">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        <span>Aktiv (planbar)</span>
      </label>
      <label>
        <span>Eintritt</span>
        <CareDatePicker
          label="Eintritt"
          value={form.employmentStart}
          max={form.employmentEnd || undefined}
          clearable
          onChange={(value) => setForm({ ...form, employmentStart: value })}
        />
      </label>
      <label>
        <span>Austritt</span>
        <CareDatePicker
          label="Austritt"
          value={form.employmentEnd}
          min={form.employmentStart || undefined}
          clearable
          onChange={(value) => setForm({ ...form, employmentEnd: value })}
        />
      </label>
      <fieldset className="area-editor-wide">
        <legend>Nicht einplanbar für</legend>
        <div className="roster-chips-select">
          {(Object.keys(EXCLUSION_LABELS) as ExclusionCategory[]).map((key) => (
            <label className="roster-checkbox" key={key}>
              <input
                type="checkbox"
                checked={form.excludedCategories.includes(key)}
                onChange={(e) =>
                  setForm({ ...form, excludedCategories: toggle(form.excludedCategories, key, e.target.checked) })
                }
              />
              <span>{EXCLUSION_LABELS[key]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="area-editor-wide">
        <legend>Wohnbereiche (planbar / Leitung)</legend>
        {data.units.map((unit) => (
          <div className="roster-chips-select" key={unit.id}>
            <label className="roster-checkbox">
              <input
                type="checkbox"
                checked={form.unitIds.includes(unit.id)}
                onChange={(e) => setForm({ ...form, unitIds: toggle(form.unitIds, unit.id, e.target.checked) })}
              />
              <span>{unit.name}: planbar</span>
            </label>
            <label className="roster-checkbox">
              <input
                type="checkbox"
                checked={form.leadUnitIds.includes(unit.id)}
                onChange={(e) => setForm({ ...form, leadUnitIds: toggle(form.leadUnitIds, unit.id, e.target.checked) })}
              />
              <span>Leitung</span>
            </label>
          </div>
        ))}
      </fieldset>
      <fieldset className="area-editor-wide">
        <legend>Qualifikationen</legend>
        {data.qualifications.map((q) => {
          const grant = form.qualifications.find((g) => g.qualificationId === q.id);
          return (
            <div className="roster-chips-select" key={q.id}>
              <label className="roster-checkbox">
                <input
                  type="checkbox"
                  checked={!!grant}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      qualifications: e.target.checked
                        ? [...form.qualifications, { qualificationId: q.id, validFrom: "2000-01-01", validUntil: null }]
                        : form.qualifications.filter((g) => g.qualificationId !== q.id),
                    })
                  }
                />
                <span>{q.name}</span>
              </label>
              {grant && (
                <label className="roster-checkbox">
                  <span>gültig bis</span>
                  <CareDatePicker
                    label={`${q.name} gültig bis`}
                    value={grant.validUntil ?? ""}
                    clearable
                    onChange={(value) =>
                      setForm({
                        ...form,
                        qualifications: form.qualifications.map((g) =>
                          g.qualificationId === q.id ? { ...g, validUntil: value || null } : g,
                        ),
                      })
                    }
                  />
                </label>
              )}
            </div>
          );
        })}
      </fieldset>
    </EditorDialog>
  );
}
