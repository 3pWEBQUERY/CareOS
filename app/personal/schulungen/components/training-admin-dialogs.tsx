"use client";

import { useState } from "react";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";
import { type LearningPayload, type Training } from "@/lib/learning-shared";
import { ScheduleDatePicker } from "@/app/betrieb/components/operations-ui";

export function SessionDialog({
  data,
  training,
  onClose,
  onSaved,
}: {
  data: LearningPayload;
  training: Training;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [date, setDate] = useState(data.today);
  const [start, setStart] = useState("13:30");
  const [end, setEnd] = useState("16:30");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState("12");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="training-session"
      eyebrow="Schulungen · Termine"
      title={`Termin für „${training.title}“`}
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await requestJson(`/api/learning/trainings/${training.id}`, {
            method: "POST",
            body: { action: "session", date, start, end, location, capacity: capacity ? Number(capacity) : null },
          });
          onSaved("Termin hinzugefügt");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Termin hinzufügen"
    >
      <label>
        <span>Datum</span>
        <ScheduleDatePicker label="Datum" value={date} onChange={setDate} />
      </label>
      <label>
        <span>Plätze</span>
        <input type="number" min={1} max={500} value={capacity} onChange={(event) => setCapacity(event.target.value)} />
      </label>
      <label>
        <span>Beginn</span>
        <input type="time" value={start} required onChange={(event) => setStart(event.target.value)} />
      </label>
      <label>
        <span>Ende</span>
        <input type="time" value={end} required onChange={(event) => setEnd(event.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>Ort</span>
        <input
          value={location}
          maxLength={180}
          placeholder="z. B. Schulungsraum EG"
          onChange={(event) => setLocation(event.target.value)}
        />
      </label>
    </EditorDialog>
  );
}

export function AssignDialog({
  data,
  training,
  onClose,
  onSaved,
}: {
  data: LearningPayload;
  training: Training;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [dueOn, setDueOn] = useState(data.today);
  const [withDue, setWithDue] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="training-assign"
      eyebrow="Schulungen · Zuweisung"
      title={`„${training.title}“ zuweisen`}
      description="Die Personen werden benachrichtigt und sehen die Schulung in ihrem Lernplan."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          const result = await requestJson<{ assigned: number }>(`/api/learning/trainings/${training.id}`, {
            method: "POST",
            body: { action: "assign", userIds: selected, dueOn: withDue ? dueOn : null },
          });
          onSaved(`${result.assigned} ${result.assigned === 1 ? "Person" : "Personen"} zugewiesen`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Zuweisen"
    >
      <fieldset className="area-editor-wide duty-assignment-options">
        <legend>Personen</legend>
        <div className="area-service-options">
          {data.people.map((person) => (
            <label key={person.id} className={selected.includes(person.id) ? "selected" : ""}>
              <input
                type="checkbox"
                checked={selected.includes(person.id)}
                onChange={() =>
                  setSelected((current) =>
                    current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id],
                  )
                }
              />
              <span>{person.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        <span>Frist</span>
        <ScheduleDatePicker label="Frist" value={dueOn} onChange={setDueOn} />
      </label>
      <fieldset className="duty-assignment-options">
        <legend>Frist</legend>
        <div className="area-service-options">
          <label className={withDue ? "selected" : ""}>
            <input type="checkbox" checked={withDue} onChange={(event) => setWithDue(event.target.checked)} />
            <span>Mit Frist</span>
          </label>
        </div>
      </fieldset>
    </EditorDialog>
  );
}
