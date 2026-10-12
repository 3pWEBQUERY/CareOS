"use client";

import { useState } from "react";
import { formatDate, useApiData } from "@/app/components/workspace-ui";
import type { VaccinationOverview } from "@/lib/vaccinations-shared";
import { CareDatePicker } from "@/app/components/care-form-controls";

// Impfstatus je Wohnbereich (Isolation & Ausbruch): wer gegen die gewählte Impfung geimpft ist, auf Wunsch nur seit
// einem gewählten Datum. Nur was dokumentiert ist; keine Empfehlung.
export function VaccinationOverviewCard({ unitId }: { unitId: string }) {
  const [target, setTarget] = useState("");
  const [since, setSince] = useState("");
  const query = new URLSearchParams({ ...(target ? { target } : {}), ...(since ? { since } : {}) }).toString();
  const { data, error } = useApiData<VaccinationOverview>(`/api/vaccinations${query ? `?${query}` : ""}`);
  const units = (data?.units ?? []).filter((unit) => !unitId || unit.id === unitId);
  const shown = target || data?.target || "";
  return (
    <section className="card vaccination-overview" aria-labelledby="vaccination-overview-title">
      <header>
        <h2 className="card-title" id="vaccination-overview-title">
          Impfstatus
        </h2>
        <p className="card-subtitle">
          Wer gegen die gewählte Impfung geimpft ist – nur was in der Akte dokumentiert ist, keine Empfehlung.
        </p>
      </header>
      {error && (
        <p className="restraints-error" role="alert">
          {error}
        </p>
      )}
      {data && !data.targets.length ? (
        <p className="record-export-note">Noch keine Impfungen erfasst (in der Akte unter Stammdaten › Impfungen).</p>
      ) : data ? (
        <>
          <div className="vaccination-filters">
            <div className="repositioning-choices" role="group" aria-label="Impfung gegen">
              {data.targets.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`day-toggle ${shown.toLowerCase() === item.toLowerCase() ? "active" : ""}`}
                  aria-pressed={shown.toLowerCase() === item.toLowerCase()}
                  onClick={() => setTarget(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <label>
              <span>Geimpft seit (freiwillig)</span>
              <CareDatePicker
                clearable
                label="Geimpft seit (freiwillig)"
                value={since}
                onChange={(value) => setSince(value)}
              />
            </label>
          </div>
          {units.map((unit) => {
            const done = unit.residents.filter((resident) => resident.lastGivenOn).length;
            return (
              <div key={unit.id} className="vaccination-unit">
                <h3>
                  {unit.name}
                  <span>
                    {done} von {unit.residents.length} geimpft
                  </span>
                </h3>
                <ul aria-label={`Impfstatus ${unit.name}`}>
                  {unit.residents.map((resident) => (
                    <li key={resident.id} className={resident.lastGivenOn ? "done" : ""}>
                      <span>
                        {resident.name}
                        {resident.room && <small> · {resident.room}</small>}
                      </span>
                      <small>
                        {resident.lastGivenOn ? `geimpft am ${formatDate(resident.lastGivenOn)}` : "nicht dokumentiert"}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      ) : (
        !error && <p className="record-export-note">Wird geladen …</p>
      )}
    </section>
  );
}
