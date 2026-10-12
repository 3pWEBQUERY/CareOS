"use client";

import { CareSelect } from "@/app/components/care-form-controls";
import { X } from "@phosphor-icons/react";
import { BodyObservation } from "./resident-record-data";
import type { ResidentRecordState } from "./use-resident-record";

export function BodyObservationDialog({ r }: { r: ResidentRecordState }) {
  const { bodyEditor, setBodyEditor, bodySaving, saveBodyObservation } = r;
  if (!bodyEditor) return null;
  return (
    <div
      className="body-observation-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && setBodyEditor(null)}
    >
      <form
        className="body-observation-editor"
        onSubmit={saveBodyObservation}
        role="dialog"
        aria-modal="true"
        aria-labelledby="body-observation-editor-title"
      >
        <div className="body-observation-editor-heading">
          <div>
            <span className="record-section-label">Körperstatus · {bodyEditor.id ? "Bearbeiten" : "Neuer Befund"}</span>
            <h2 id="body-observation-editor-title">{bodyEditor.id ? "Befund bearbeiten" : "Befund erfassen"}</h2>
            <p>
              {bodyEditor.id
                ? "Art, Bezeichnung und Verlauf des Befunds anpassen."
                : "Die gewählte Körperstelle ist am Modell blau markiert."}
            </p>
          </div>
          <button type="button" aria-label="Befundeditor schliessen" onClick={() => setBodyEditor(null)}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="body-observation-editor-fields">
          <label>
            Art
            <CareSelect
              menuZIndex={160}
              label="Art"
              value={
                { wound: "Wunde", redness: "Rötung", fracture: "Fraktur", other: "Sonstiges" }[bodyEditor.draft.kind]
              }
              options={["Wunde", "Rötung", "Fraktur", "Sonstiges"]}
              onChange={(value) =>
                setBodyEditor(
                  (current) =>
                    current && {
                      ...current,
                      draft: {
                        ...current.draft,
                        kind: (
                          {
                            Wunde: "wound",
                            Rötung: "redness",
                            Fraktur: "fracture",
                            Sonstiges: "other",
                          } as Record<string, BodyObservation["kind"]>
                        )[value],
                      },
                    },
                )
              }
            />
          </label>
          <label>
            Bezeichnung
            <input
              required
              maxLength={120}
              value={bodyEditor.draft.label}
              onChange={(event) =>
                setBodyEditor(
                  (current) => current && { ...current, draft: { ...current.draft, label: event.target.value } },
                )
              }
              placeholder="z. B. Druckstelle"
            />
          </label>
          <label>
            Körperstelle
            <input
              required
              maxLength={160}
              value={bodyEditor.draft.location}
              onChange={(event) =>
                setBodyEditor(
                  (current) => current && { ...current, draft: { ...current.draft, location: event.target.value } },
                )
              }
              placeholder="z. B. rechter Unterarm"
            />
            {!bodyEditor.id && (
              <small className="body-observation-editor-note">
                Aus der Markierung am Modell erkannt – bei Bedarf genauer beschreiben.
              </small>
            )}
          </label>
          <label>
            Status
            <CareSelect
              menuZIndex={160}
              label="Status"
              value={bodyEditor.draft.status}
              options={["Beobachten", "In Behandlung", "Kontrolle geplant", "Abgeschlossen"]}
              onChange={(value) =>
                setBodyEditor((current) => current && { ...current, draft: { ...current.draft, status: value } })
              }
            />
          </label>
          <label className="body-observation-editor-wide">
            Beobachtung
            <textarea
              rows={3}
              maxLength={4000}
              value={bodyEditor.draft.notes}
              onChange={(event) =>
                setBodyEditor(
                  (current) => current && { ...current, draft: { ...current.draft, notes: event.target.value } },
                )
              }
              placeholder="Befund, Versorgung und nächste Kontrolle…"
            />
          </label>
        </div>
        {r.bodyError && (
          <p className="appointment-editor-error" role="alert">
            {r.bodyError}
          </p>
        )}
        <div className="body-observation-editor-actions">
          <button className="secondary-button" type="button" onClick={() => setBodyEditor(null)}>
            Abbrechen
          </button>
          <button className="primary-button" type="submit" disabled={bodySaving}>
            {bodySaving ? "Speichern…" : "Befund speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}
