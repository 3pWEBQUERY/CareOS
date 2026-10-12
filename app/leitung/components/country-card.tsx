"use client";

import { useState } from "react";
import { requestJson } from "@/app/components/workspace-ui";
import { loadWorkContext } from "@/app/components/care-context";
import { COUNTRIES, COUNTRY_CODES, holidaySource, regionName, type CountryCode } from "@/lib/country";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { notifyAdminChanged } from "./admin-board";

// Land der Einrichtung: wählt die gesetzliche Einstufung (Pflegestufen, -grade, Pflegegeldstufen), die
// Sozialversicherungsnummer, Feiertage und Qualifikationen; zeigt die Vorgaben des gewählten Landes.
export function CountryCard({
  country,
  region,
  confirmed,
  onSaved,
  showToast,
}: {
  country: CountryCode;
  region: string | null;
  confirmed: boolean;
  onSaved: () => void;
  showToast: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const profile = COUNTRIES[country];
  const save = (next: CountryCode, nextRegion: string | null) => {
    setSaving(true);
    requestJson("/api/branding/country", { method: "PUT", body: { country: next, region: nextRegion } })
      .then(() => {
        onSaved();
        notifyAdminChanged();
        void loadWorkContext(true);
        showToast(
          nextRegion && next === country
            ? `${COUNTRIES[next].region.label} gespeichert: ${regionName(next, nextRegion)}`
            : `Land gespeichert: ${COUNTRIES[next].name}`,
        );
      })
      .catch((reason: Error) => showToast(reason.message))
      .finally(() => setSaving(false));
  };
  return (
    <section className="card admin-terminology-card admin-country-card" id="land" aria-labelledby="admin-country-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Land</p>
          <h2 className="card-title" id="admin-country-title">
            Land der Einrichtung
          </h2>
          <p className="card-subtitle">
            Bestimmt Pflegestufen, Sozialversicherungsnummer, Feiertage und Qualifikationen nach den Vorgaben des Landes
          </p>
        </div>
      </div>
      <div className="worklist-filters admin-terminology-options" role="group" aria-label="Land wählen">
        {COUNTRY_CODES.map((code) => (
          <button
            className={country === code ? "active" : ""}
            type="button"
            key={code}
            aria-pressed={country === code}
            disabled={saving}
            onClick={() => (country !== code || !confirmed) && save(code, country === code ? region : null)}
          >
            {COUNTRIES[code].name}
          </button>
        ))}
      </div>
      <div className="admin-country-region">
        <span>{profile.region.label}</span>
        <CareOptionSelect
          label={profile.region.label}
          value={region ?? ""}
          options={[
            { value: "", label: `Kein ${profile.region.label} (nur landesweite Feiertage)` },
            ...profile.region.options.map((option) => ({ value: option.code, label: option.name })),
          ]}
          onChange={(value) => value !== (region ?? "") && save(country, value || null)}
          disabled={saving}
        />
      </div>
      {!confirmed && (
        <p className="admin-country-hint">Noch nicht bestätigt: bitte das Land wählen (Standard ist die Schweiz).</p>
      )}
      <div className="admin-country-body">
        <div className="admin-country-section">
          <h3>
            {profile.careLevels.plural} · {profile.careLevels.basis}
          </h3>
          <p>{profile.careLevels.system}.</p>
          <ul
            className="admin-country-levels"
            aria-label={`${profile.careLevels.label} und ${profile.careLevels.unit}`}
          >
            {profile.careLevels.levels.map((level) => (
              <li key={level.value}>
                <strong>{level.value}</strong>
                <span>{level.detail}</span>
              </li>
            ))}
          </ul>
          <p>{profile.careLevels.assessment}</p>
        </div>
        <dl className="admin-country-facts">
          <dt>Sozialversicherungsnummer</dt>
          <dd>
            {profile.socialNumber.label} · Format {profile.socialNumber.format}
          </dd>
          <dt>Versicherung</dt>
          <dd>
            {profile.insurance.insurerLabel} · {profile.insurance.numberLabel}
          </dd>
          <dt>Feiertage im Dienstplan</dt>
          <dd>
            Gesetzliche Feiertage {holidaySource(country, region)} zum Übernehmen; kommunale Feiertage einzeln ergänzen.
          </dd>
          <dt>Qualifikationen</dt>
          <dd>
            {profile.qualifications.map((q) => q.name).join(", ")}. Beim Speichern ergänzt; bestehende bleiben. Ob eine
            Qualifikation zur Medikation berechtigt, legt die Leitung im Dienstplan fest.
          </dd>
        </dl>
      </div>
    </section>
  );
}
