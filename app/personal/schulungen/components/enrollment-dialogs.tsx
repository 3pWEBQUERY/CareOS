"use client";

import { useState } from "react";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";
import { TRAINING_FORMATS, type Training } from "@/lib/learning-shared";
import { ScheduleSelect } from "@/app/betrieb/components/operations-ui";
import { NO_SESSION, sessionLabel } from "./learning-utils";

export function EnrollDialog({
  training,
  onClose,
  onSaved,
}: {
  training: Training;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [now] = useState(() => Date.now());
  const open = training.sessions.filter(
    (s) => Date.parse(s.startsAt) > now && (!s.capacity || s.booked < s.capacity || s.mine),
  );
  const [session, setSession] = useState(training.enrollment?.sessionId ?? open[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const label = open.find((s) => s.id === session);
  return (
    <EditorDialog
      id="learning-enroll"
      eyebrow={`Schulungen · ${TRAINING_FORMATS[training.format]}`}
      title={training.enrollment ? "Termin wählen" : `Anmelden: ${training.title}`}
      description={training.description ?? undefined}
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await requestJson("/api/learning/enrollments", {
            method: "POST",
            body: { trainingId: training.id, sessionId: session || null },
          });
          onSaved(session ? "Für den Termin angemeldet" : "Für die Schulung angemeldet");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Anmeldung fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Anmelden"
    >
      <label className="area-editor-wide">
        <span>Termin</span>
        <ScheduleSelect
          label="Termin"
          value={label ? sessionLabel(label) : NO_SESSION}
          options={[...open.map(sessionLabel), NO_SESSION]}
          onChange={(value) => setSession(open.find((s) => sessionLabel(s) === value)?.id ?? "")}
        />
      </label>
      {!open.length && (
        <p className="area-editor-wide list-hint">
          Aktuell sind keine Termine offen. Du wirst ohne Termin angemeldet und kannst später einen wählen.
        </p>
      )}
    </EditorDialog>
  );
}

export function ProgressDialog({
  training,
  onClose,
  onSaved,
}: {
  training: Training;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [progress, setProgress] = useState(training.enrollment?.progress ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="learning-progress"
      eyebrow="Schulungen · Fortschritt"
      title={training.title}
      description="Melde, wie weit du bist. Den Abschluss erfasst du anschliessend als Nachweis."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        try {
          await requestJson(`/api/learning/enrollments/${training.enrollment?.id}`, {
            method: "POST",
            body: { action: "progress", progress },
          });
          onSaved(`Fortschritt ${progress} % gespeichert`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label className="area-editor-wide">
        <span>Fortschritt</span>
        <ScheduleSelect
          label="Fortschritt"
          value={`${progress} %`}
          options={["0 %", "25 %", "50 %", "75 %", "100 %"]}
          onChange={(value) => setProgress(Number.parseInt(value, 10))}
        />
      </label>
    </EditorDialog>
  );
}
