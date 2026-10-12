"use client";

import { useState } from "react";
import { formatDate } from "@/lib/roster/time";
import { COUNTRIES, holidaySource } from "@/lib/country";
import { rosterRequest } from "./roster-api";
import { act, type TabProps } from "./settings-tab-shared";
import { CareDatePicker } from "@/app/components/care-form-controls";

// --- Feiertage -----------------------------------------------------------------------------------

export function HolidaysTab({ data, reload, showToast }: TabProps) {
  const year = new Date().getFullYear();
  const source = holidaySource(data.country, data.region);
  const [form, setForm] = useState({ date: "", name: "" });
  return (
    <section className="card roster-card">
      <div className="roster-section-head">
        <div>
          <h2>Feiertage</h2>
          <p>
            Feiertage senken das Monatssoll und werden für Feiertagsstunden ausgewertet. Übernommen werden die
            gesetzlichen Feiertage ({source}); {COUNTRIES[data.country].region.label} legt die Administration in der
            Konfiguration fest, kommunale Feiertage einzeln ergänzen.
          </p>
        </div>
        <div className="roster-row-actions">
          {[year, year + 1].map((y) => (
            <button
              key={y}
              className="secondary-button"
              type="button"
              onClick={() =>
                void act(
                  () =>
                    rosterRequest("/api/dienstplan/settings/holidays", {
                      method: "POST",
                      body: { action: "importHolidays", year: y },
                    }),
                  `Feiertage ${y} (${source}) übernommen`,
                  reload,
                  showToast,
                )
              }
            >
              {source} {y} übernehmen
            </button>
          ))}
        </div>
      </div>
      <div className="roster-form-grid">
        <label>
          Datum
          <CareDatePicker label="Datum" value={form.date} onChange={(value) => setForm({ ...form, date: value })} />
        </label>
        <label>
          Bezeichnung
          <input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
      </div>
      <div className="roster-form-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!form.date || !form.name.trim()}
          onClick={() =>
            void act(
              () => rosterRequest("/api/dienstplan/settings/holidays", { method: "POST", body: form }),
              "Feiertag gespeichert",
              reload,
              showToast,
            ).then(() => setForm({ date: "", name: "" }))
          }
        >
          Feiertag hinzufügen
        </button>
      </div>
      <div className="roster-table-wrap">
        <table className="roster-table">
          <tbody>
            {data.holidays.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.date, true)}</td>
                <td>{h.name}</td>
                <td>
                  <button
                    className="appointment-danger-button"
                    type="button"
                    onClick={() =>
                      void act(
                        () => rosterRequest(`/api/dienstplan/settings/holidays/${h.id}`, { method: "DELETE" }),
                        "Feiertag gelöscht",
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
            {!data.holidays.length && (
              <tr>
                <td className="roster-muted">Noch keine Feiertage gepflegt.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
