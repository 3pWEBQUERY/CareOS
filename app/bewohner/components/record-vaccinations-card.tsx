"use client";

import { useState } from "react";
import { CareDatePicker } from "@/app/components/care-form-controls";
import { Plus, Trash } from "@phosphor-icons/react";
import { EditorDialog, formatDate, requestJson, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import {
  VACCINATION_PLACES,
  type Vaccination,
  type VaccinationList,
  type VaccinationPlace,
} from "@/lib/vaccinations-shared";

type Draft = {
  givenOn: string;
  target: string;
  vaccine: string;
  lot: string;
  place: VaccinationPlace;
  givenBy: string;
  note: string;
};

// Impfungen der Person, wie gegeben (im Haus oder extern). Fehleinträge werden mit Begründung entfernt.
export function RecordVaccinationsCard({
  residentId,
  residentName,
  onAction,
}: {
  residentId: string;
  residentName: string;
  onAction: (message: string) => void;
}) {
  const list = useApiData<VaccinationList>(`/api/residents/${residentId}/vaccinations`);
  const data = list.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Vaccination | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>, message: string) {
    setSaving(true);
    setError("");
    try {
      await action();
      list.reload();
      onAction(message);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="record-card master-data-card" aria-labelledby="vaccinations-title">
      <div className="record-card-heading">
        <div>
          <span className="record-section-label">Medizin</span>
          <h3 id="vaccinations-title">Impfungen</h3>
        </div>
        {data?.canWrite && (
          <button
            type="button"
            aria-label="Impfung erfassen"
            onClick={() => {
              setError("");
              setDraft({
                givenOn: todayInZurich(),
                target: "",
                vaccine: "",
                lot: "",
                place: "inhouse",
                givenBy: "",
                note: "",
              });
            }}
          >
            <Plus aria-hidden="true" /> Erfassen
          </button>
        )}
      </div>
      <div className="master-data-form-grid single-column">
        {list.error && !data ? (
          <p className="restraints-error" role="alert">
            {list.error}
          </p>
        ) : !data ? (
          <p className="record-export-note">Wird geladen …</p>
        ) : !data.vaccinations.length ? (
          <p className="record-export-note">Noch keine Impfungen erfasst – z. B. aus dem Impfausweis übernehmen.</p>
        ) : (
          <ul className="death-checklist diagnosis-list" aria-label="Impfungen">
            {data.vaccinations.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.target}
                    <span className="diagnosis-code">{formatDate(item.givenOn)}</span>
                  </strong>
                  <small>
                    {[
                      item.vaccine,
                      item.lot && `Charge ${item.lot}`,
                      item.place === "inhouse" ? "im Haus" : "extern",
                      item.givenBy && `geimpft von ${item.givenBy}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  {item.note && <small>{item.note}</small>}
                </div>
                {data.canWrite && (
                  <span className="diagnosis-actions">
                    <button
                      type="button"
                      className="death-checklist-action"
                      aria-label={`Impfung ${item.target} vom ${formatDate(item.givenOn)} entfernen`}
                      onClick={() => {
                        setError("");
                        setReason("");
                        setRemoving(item);
                      }}
                    >
                      <Trash aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {draft && data && (
        <EditorDialog
          id="vaccination"
          eyebrow={`${residentName} · Impfungen`}
          title="Impfung erfassen"
          description="Wie gegeben, z. B. aus dem Impfausweis oder nach der Impfung im Haus."
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            const saved = await run(
              () => requestJson(`/api/residents/${residentId}/vaccinations`, { method: "POST", body: draft }),
              "Impfung erfasst",
            );
            if (saved) setDraft(null);
          }}
          saving={saving}
          error={error}
          submitLabel="Impfung speichern"
        >
          <label>
            <span>Geimpft am</span>
            <CareDatePicker
              label="Geimpft am"
              value={draft.givenOn}
              max={todayInZurich()}
              onChange={(value) => setDraft({ ...draft, givenOn: value })}
            />
          </label>
          <label>
            <span>Impfung gegen</span>
            <input
              required
              maxLength={120}
              placeholder="z. B. Grippe"
              value={draft.target}
              onChange={(event) => setDraft({ ...draft, target: event.target.value })}
            />
          </label>
          {data.targets.length > 0 && (
            <div className="area-editor-wide repositioning-choices" role="group" aria-label="Bisher verwendet">
              {data.targets.map((target) => (
                <button
                  key={target}
                  type="button"
                  className={`day-toggle ${draft.target === target ? "active" : ""}`}
                  aria-pressed={draft.target === target}
                  onClick={() => setDraft({ ...draft, target })}
                >
                  {target}
                </button>
              ))}
            </div>
          )}
          <label>
            <span>Präparat</span>
            <input
              maxLength={200}
              value={draft.vaccine}
              onChange={(event) => setDraft({ ...draft, vaccine: event.target.value })}
            />
          </label>
          <label>
            <span>Charge</span>
            <input
              maxLength={60}
              value={draft.lot}
              onChange={(event) => setDraft({ ...draft, lot: event.target.value })}
            />
          </label>
          <fieldset className="area-editor-wide">
            <legend>Ort</legend>
            <div className="repositioning-choices" role="group" aria-label="Ort der Impfung">
              {(Object.keys(VACCINATION_PLACES) as VaccinationPlace[]).map((place) => (
                <button
                  key={place}
                  type="button"
                  className={`day-toggle ${draft.place === place ? "active" : ""}`}
                  aria-pressed={draft.place === place}
                  onClick={() => setDraft({ ...draft, place })}
                >
                  {VACCINATION_PLACES[place]}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            <span>Geimpft von</span>
            <input
              maxLength={200}
              placeholder="z. B. Hausärztin, Praxis"
              value={draft.givenBy}
              onChange={(event) => setDraft({ ...draft, givenBy: event.target.value })}
            />
          </label>
          <label className="area-editor-wide">
            <span>Bemerkung</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {removing && (
        <EditorDialog
          id="vaccination-remove"
          eyebrow={`${residentName} · Impfungen`}
          title="Impfung entfernen"
          description={`„${removing.target}“ vom ${formatDate(removing.givenOn)} wird entfernt. Nur für Fehleinträge; steht im Protokoll der Akte.`}
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            if (!reason.trim()) return setError("Bitte angeben, warum der Eintrag entfernt wird.");
            const done = await run(
              () => requestJson(`/api/vaccinations/${removing.id}`, { method: "DELETE", body: { reason } }),
              "Impfung entfernt",
            );
            if (done) setRemoving(null);
          }}
          saving={saving}
          error={error}
          submitLabel="Entfernen"
          danger
        >
          <label className="area-editor-wide">
            <span>Grund</span>
            <input
              required
              maxLength={500}
              placeholder="z. B. bei der falschen Person erfasst"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </EditorDialog>
      )}
    </section>
  );
}
