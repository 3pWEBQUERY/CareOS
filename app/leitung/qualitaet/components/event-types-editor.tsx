"use client";

import { useState } from "react";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";

let nextKey = 0;

// Eigene Ereignisarten der Einrichtung; die eingebauten bleiben, weil Kennzahlen (z. B. Stürze) darauf beruhen.
export function EventTypesEditor({
  builtIn,
  custom,
  onClose,
  onSaved,
}: {
  builtIn: string[];
  custom: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [items, setItems] = useState(() => custom.map((name) => ({ key: ++nextKey, name })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="quality-event-types"
      eyebrow="Qualität · Ereignisarten"
      title="Ereignisarten"
      description="Eigene Arten erscheinen beim Melden und in den Ablaufketten. Wird eine Art entfernt, entfällt ihre Ablaufkette; gemeldete Ereignisse behalten ihre Art."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await requestJson("/api/quality/event-types", {
            method: "PUT",
            body: { custom: items.map((item) => item.name) },
          });
          onSaved("Ereignisarten gespeichert");
        } catch (cause) {
          setError((cause as Error).message);
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Ereignisarten speichern"
    >
      <fieldset className="area-editor-wide event-types-builtin">
        <legend>Eingebaut</legend>
        <p>{builtIn.join(" · ")}</p>
      </fieldset>
      <fieldset className="area-editor-wide event-types-custom">
        <legend>Eigene Ereignisarten</legend>
        {items.map((item, index) => (
          <div className="event-types-row" key={item.key}>
            <label>
              <span>Eigene Ereignisart {index + 1}</span>
              <input
                value={item.name}
                maxLength={80}
                required
                minLength={3}
                onChange={(event) =>
                  setItems((current) =>
                    current.map((entry) => (entry.key === item.key ? { ...entry, name: event.target.value } : entry)),
                  )
                }
              />
            </label>
            <button
              className="quiet-button"
              type="button"
              aria-label={`Eigene Ereignisart ${index + 1} entfernen`}
              onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}
            >
              Entfernen
            </button>
          </div>
        ))}
        {!items.length && <p className="list-hint">Noch keine eigenen Ereignisarten.</p>}
        <button
          className="secondary-button"
          type="button"
          onClick={() => setItems((current) => [...current, { key: ++nextKey, name: "" }])}
        >
          Ereignisart hinzufügen
        </button>
      </fieldset>
    </EditorDialog>
  );
}
