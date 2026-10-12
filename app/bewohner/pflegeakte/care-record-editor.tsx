"use client";

import { useCountry, useTerms } from "@/app/components/care-context";
import { NOT_ASSESSED, careLevelOptions } from "@/lib/country";
import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { CareDatePicker, CareSelect, formatCareDate } from "@/app/components/care-form-controls";
import { requestJson, todayInZurich } from "@/app/components/workspace-ui";
import type { CareRecordRow } from "@/lib/care-records-shared";

const NO_OWNER = "Noch nicht festgelegt";

const plusDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// Creates the resident's care plan, which opens the care record.
export function CareRecordEditor({
  residents,
  staff,
  initialResidentId,
  onClose,
  onCreated,
}: {
  residents: CareRecordRow[];
  staff: Array<{ id: string; name: string }>;
  initialResidentId: string | null;
  onClose: () => void;
  onCreated: (residentId: string, message: string) => void;
}) {
  const t = useTerms();
  const candidates = residents.filter((resident) => !resident.planId);
  const label = (resident: CareRecordRow) => `${resident.name} · ${resident.room || "ohne Zimmer"}`;
  const [residentId, setResidentId] = useState(
    candidates.find((resident) => resident.id === initialResidentId)?.id ?? candidates[0]?.id ?? "",
  );
  const country = useCountry();
  const [careLevel, setCareLevel] = useState(NOT_ASSESSED);
  const [ownerId, setOwnerId] = useState("");
  const [startsOn, setStartsOn] = useState(todayInZurich);
  const [reviewOn, setReviewOn] = useState(() => plusDays(todayInZurich(), 90));
  const [focus, setFocus] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const resident = candidates.find((item) => item.id === residentId) ?? null;
  const ownerName = staff.find((person) => person.id === ownerId)?.name ?? NO_OWNER;

  async function submit() {
    if (!resident) return;
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/care-planning/plans", {
        method: "POST",
        body: {
          residentId: resident.id,
          careLevel: careLevel === NOT_ASSESSED ? null : careLevel,
          ownerId: ownerId || null,
          startsOn,
          reviewOn,
          focus,
        },
      });
      onCreated(resident.id, `Pflegeakte für ${resident.name} wurde erstellt`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Die Pflegeakte konnte nicht erstellt werden.");
      setSaving(false);
    }
  }

  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && !saving && onClose()}
    >
      <section
        className="area-editor-panel care-record-editor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="care-record-editor-title"
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">CareOS {t.many} · Pflegeakte</p>
            <h2 id="care-record-editor-title">Pflegeakte erstellen</h2>
            <p>
              Lege den Pflegeplan an und definiere direkt die Zuständigkeit und die erste Evaluation. Ziele und
              Massnahmen ergänzt du anschliessend in der Pflegeplanung.
            </p>
          </div>
          <button
            className="area-editor-close"
            type="button"
            onClick={onClose}
            aria-label="Pflegeakteneditor schliessen"
          >
            ×
          </button>
        </header>
        <form
          className="area-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {candidates.length === 0 ? (
            <div className="area-editor-intro">
              <span className="area-editor-icon">
                <ModuleIcon name="check" />
              </span>
              <div>
                <strong>Alle {t.many} haben eine Pflegeakte</strong>
                <p>Für jeden aktiven {t.oneOblique} besteht bereits ein offener Pflegeplan.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="area-editor-intro">
                <span className="area-editor-icon">
                  <ModuleIcon name="plan" />
                </span>
                <div>
                  <strong>Neue Pflegeakte</strong>
                  <p>Die Akte wird mit dem ausgewählten {t.oneOblique} verknüpft und für das Team sichtbar.</p>
                </div>
                <span className="duty-assignment-status">
                  <i />
                  {candidates.length} ohne Pflegeakte
                </span>
              </div>
              <div className="area-editor-grid">
                <label className="area-editor-wide">
                  {t.one}
                  <CareSelect
                    label={t.one}
                    value={resident ? label(resident) : ""}
                    options={candidates.map(label)}
                    onChange={(value) => setResidentId(candidates.find((item) => label(item) === value)?.id ?? "")}
                  />
                </label>
                <label>
                  {country.careLevels.label}
                  <CareSelect
                    label={country.careLevels.label}
                    value={careLevel}
                    options={[NOT_ASSESSED, ...careLevelOptions(country.code)]}
                    onChange={setCareLevel}
                  />
                </label>
                <label>
                  Pflegebeginn
                  <CareDatePicker label="Pflegebeginn" value={startsOn} onChange={setStartsOn} />
                </label>
                <label>
                  Bezugspflege
                  <CareSelect
                    label="Bezugspflege"
                    value={ownerName}
                    options={[NO_OWNER, ...staff.map((person) => person.name)]}
                    onChange={(value) => setOwnerId(staff.find((person) => person.name === value)?.id ?? "")}
                  />
                </label>
                <label>
                  Erste Evaluation
                  <CareDatePicker label="Erste Evaluation" value={reviewOn} onChange={setReviewOn} />
                </label>
                <label className="area-editor-wide">
                  Pflegefokus
                  <textarea
                    required
                    maxLength={4000}
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                    placeholder="z. B. Mobilität erhalten, Trinkmenge sichern, Schmerzen beobachten …"
                    rows={5}
                  />
                </label>
              </div>
              {resident && (
                <div className="duty-assignment-summary">
                  <span>
                    <strong>{resident.name}</strong>
                    <small>
                      {resident.room || "ohne Zimmer"} · {careLevel}
                    </small>
                  </span>
                  <span>
                    <strong>Start {formatCareDate(startsOn)}</strong>
                    <small>
                      {ownerName} · Evaluation {formatCareDate(reviewOn)}
                    </small>
                  </span>
                </div>
              )}
            </>
          )}
          {error && (
            <p className="appointment-editor-error" role="alert">
              {error}
            </p>
          )}
          <footer className="area-editor-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
              {candidates.length === 0 ? "Schliessen" : "Abbrechen"}
            </button>
            {candidates.length > 0 && (
              <button className="primary-button" type="submit" disabled={saving || !resident}>
                <ModuleIcon name="check" /> {saving ? "Speichern…" : "Pflegeakte erstellen"}
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}
