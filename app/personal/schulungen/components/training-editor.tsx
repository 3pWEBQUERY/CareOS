"use client";

import { useState } from "react";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";
import {
  TRAINING_CATEGORIES,
  TRAINING_FORMATS,
  type LearningPayload,
  type Training,
  type TrainingFormat,
} from "@/lib/learning-shared";
import { ScheduleSelect } from "@/app/betrieb/components/operations-ui";
import { QuizEditor, quizBody, quizDraft } from "./quiz-editor";

export function TrainingEditor({
  data,
  training,
  onClose,
  onSaved,
}: {
  data: LearningPayload;
  training: Training | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [title, setTitle] = useState(training?.title ?? "");
  const [description, setDescription] = useState(training?.description ?? "");
  const [category, setCategory] = useState(training?.category ?? "Pflege");
  const [format, setFormat] = useState<TrainingFormat>(training?.format ?? "presence");
  const [duration, setDuration] = useState(String(training?.durationMinutes ?? ""));
  const [mandatory, setMandatory] = useState(training?.mandatory ?? false);
  const [validFor, setValidFor] = useState(String(training?.validForMonths ?? ""));
  const [link, setLink] = useState(training?.linkUrl ?? "");
  const [roles, setRoles] = useState<string[]>(training?.requiredRoles ?? []);
  const [quiz, setQuiz] = useState(() => quizDraft(training?.quiz ?? null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="training-editor"
      eyebrow="Schulungen · Kurskatalog"
      title={training ? "Schulung bearbeiten" : "Schulung anlegen"}
      description="Pflichtschulungen erscheinen im Kompetenzprofil der betroffenen Rollen; mit Gültigkeit werden Auffrischungen automatisch fällig."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          const body = {
            title,
            description,
            category,
            format,
            durationMinutes: duration ? Number(duration) : null,
            mandatory,
            validForMonths: validFor ? Number(validFor) : null,
            linkUrl: link,
            requiredRoles: mandatory ? roles : [],
            quiz: quizBody(quiz),
          };
          if (training)
            await requestJson(`/api/learning/trainings/${training.id}`, {
              method: "POST",
              body: { action: "update", ...body },
            });
          else await requestJson("/api/learning/trainings", { method: "POST", body });
          onSaved(training ? "Schulung gespeichert" : `Schulung „${title}“ angelegt`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel={training ? "Speichern" : "Anlegen"}
    >
      <label className="area-editor-wide">
        <span>Titel</span>
        <input value={title} maxLength={220} required autoFocus onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        <span>Kategorie</span>
        <ScheduleSelect label="Kategorie" value={category} options={[...TRAINING_CATEGORIES]} onChange={setCategory} />
      </label>
      <label>
        <span>Format</span>
        <ScheduleSelect
          label="Format"
          value={TRAINING_FORMATS[format]}
          options={Object.values(TRAINING_FORMATS)}
          onChange={(value) =>
            setFormat(
              (Object.keys(TRAINING_FORMATS) as TrainingFormat[]).find((k) => TRAINING_FORMATS[k] === value) ??
                "presence",
            )
          }
        />
      </label>
      <label>
        <span>Dauer (Minuten)</span>
        <input
          type="number"
          min={5}
          max={2400}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
      </label>
      <label>
        <span>Gültigkeit (Monate, leer = unbefristet)</span>
        <input type="number" min={1} max={120} value={validFor} onChange={(event) => setValidFor(event.target.value)} />
      </label>
      {format === "elearning" && (
        <label className="area-editor-wide">
          <span>Kurslink</span>
          <input
            value={link}
            maxLength={1000}
            placeholder="https://…"
            onChange={(event) => setLink(event.target.value)}
          />
        </label>
      )}
      <label className="area-editor-wide">
        <span>Beschreibung</span>
        <textarea
          rows={3}
          maxLength={5000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <fieldset className="area-editor-wide duty-assignment-options">
        <legend>Pflichtschulung</legend>
        <div className="area-service-options">
          <label className={mandatory ? "selected" : ""}>
            <input type="checkbox" checked={mandatory} onChange={(event) => setMandatory(event.target.checked)} />
            <span>Pflichtnachweis</span>
          </label>
          {mandatory &&
            data.roles.map((role) => (
              <label key={role.key} className={roles.includes(role.key) ? "selected" : ""}>
                <input
                  type="checkbox"
                  checked={roles.includes(role.key)}
                  onChange={() =>
                    setRoles((current) =>
                      current.includes(role.key) ? current.filter((r) => r !== role.key) : [...current, role.key],
                    )
                  }
                />
                <span>{role.name}</span>
              </label>
            ))}
        </div>
        {mandatory && <p className="list-hint">Keine Rolle gewählt = gilt für alle Mitarbeitenden.</p>}
      </fieldset>
      <QuizEditor draft={quiz} onChange={setQuiz} />
    </EditorDialog>
  );
}
