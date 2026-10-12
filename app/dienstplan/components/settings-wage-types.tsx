"use client";

import { useState } from "react";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { WAGE_SOURCES, WAGE_SOURCE_LABELS, wageUnit, type WageSource } from "@/lib/roster/payroll-shared";
import { rosterRequest } from "./roster-api";
import { act, type TabProps } from "./settings-tab-shared";

// --- Lohnarten (Lohn-Export) ---------------------------------------------------------------------

export function WageTypesTab({ data, reload, showToast }: TabProps) {
  const [form, setForm] = useState<{ code: string; name: string; source: WageSource }>({
    code: "",
    name: "",
    source: "ACTUAL_HOURS",
  });
  const missingNumbers = data.employees.filter((person) => person.active && !person.employeeNumber).length;
  return (
    <section className="card roster-card">
      <div className="roster-section-head">
        <div>
          <h2>Lohnarten</h2>
          <p>
            Welcher Wert der Arbeitszeit unter welcher Lohnart an die Lohnbuchhaltung geht. Nummern und Bezeichnungen
            übernehmen Sie aus Ihrer Lohnbuchhaltung; Ansätze und Zuschläge rechnet die Lohnbuchhaltung. Die Datei gibt
            es unter Arbeitszeit › „CSV Lohn“, die Personalnummer steht im Reiter Personal.
          </p>
          {missingNumbers > 0 && (
            <p className="roster-muted">
              {missingNumbers === 1
                ? "Bei 1 Person in diesem Wohnbereich fehlt die Personalnummer."
                : `Bei ${missingNumbers} Personen in diesem Wohnbereich fehlt die Personalnummer.`}
            </p>
          )}
        </div>
      </div>
      <div className="roster-form-grid">
        <label>
          Nummer
          <input value={form.code} maxLength={20} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </label>
        <label>
          Bezeichnung
          <input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Wert aus der Arbeitszeit
          <CareOptionSelect
            label="Wert aus der Arbeitszeit"
            value={form.source}
            onChange={(value) => setForm({ ...form, source: value as WageSource })}
            options={WAGE_SOURCES.map((source) => ({ value: source, label: WAGE_SOURCE_LABELS[source] }))}
          />
        </label>
      </div>
      <div className="roster-form-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!form.code.trim() || !form.name.trim()}
          onClick={() =>
            void act(
              () => rosterRequest("/api/dienstplan/settings/wage-types", { method: "POST", body: form }),
              "Lohnart gespeichert",
              reload,
              showToast,
            ).then(() => setForm({ code: "", name: "", source: form.source }))
          }
        >
          Lohnart hinzufügen
        </button>
      </div>
      <div className="roster-table-wrap">
        <table className="roster-table" aria-label="Lohnarten">
          <thead>
            <tr>
              <th>Nummer</th>
              <th>Bezeichnung</th>
              <th>Wert aus der Arbeitszeit</th>
              <th>Einheit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.wageTypes.map((wageType) => (
              <tr key={wageType.id}>
                <td>
                  <strong>{wageType.code}</strong>
                </td>
                <td>{wageType.name}</td>
                <td>{WAGE_SOURCE_LABELS[wageType.source]}</td>
                <td>{wageUnit(wageType.source)}</td>
                <td>
                  <button
                    className="appointment-danger-button"
                    type="button"
                    onClick={() =>
                      void act(
                        () => rosterRequest(`/api/dienstplan/settings/wage-types/${wageType.id}`, { method: "DELETE" }),
                        "Lohnart gelöscht",
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
            {!data.wageTypes.length && (
              <tr>
                <td className="roster-muted" colSpan={5}>
                  Noch keine Lohnarten festgelegt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
