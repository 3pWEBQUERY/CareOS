"use client";

import { useState } from "react";
import { EditorDialog } from "@/app/components/workspace-ui";
import { CERTIFICATE_TYPES, type LearningPayload } from "@/lib/learning-shared";
import { ScheduleDatePicker, ScheduleSelect } from "@/app/betrieb/components/operations-ui";
import { postForm } from "./learning-utils";
import DocumentFileField from "@/app/bewohner/components/document-file-field";

export function EvidenceDialog({
  data,
  trainingId,
  userId,
  onClose,
  onSaved,
}: {
  data: LearningPayload;
  trainingId: string | null;
  userId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [training, setTraining] = useState(
    trainingId ?? data.trainings.find((t) => t.mandatory)?.id ?? data.trainings[0]?.id ?? "",
  );
  const [person, setPerson] = useState(userId ?? data.currentUserId);
  const [completedOn, setCompletedOn] = useState(data.today);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = data.trainings.find((t) => t.id === training);
  const personName = data.people.find((p) => p.id === person)?.name ?? "Ich";
  return (
    <EditorDialog
      id="learning-evidence"
      eyebrow="Schulungen · Nachweise"
      title="Nachweis erfassen"
      description={
        data.canManage
          ? "Von der Leitung erfasste Nachweise gelten sofort als geprüft."
          : "Die Leitung prüft deinen Nachweis und bestätigt ihn im Kompetenzprofil."
      }
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          const form = new FormData();
          form.set("trainingId", training);
          if (person !== data.currentUserId) form.set("userId", person);
          form.set("completedOn", completedOn);
          form.set("note", note);
          if (file) form.set("certificate", file);
          await postForm("/api/learning/evidence", form);
          onSaved(`Nachweis „${selected?.title ?? ""}“ gespeichert`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Nachweis speichern"
    >
      <label className="area-editor-wide">
        <span>Schulung</span>
        <ScheduleSelect
          label="Schulung"
          value={selected?.title ?? "Schulung wählen"}
          options={data.trainings.map((t) => t.title)}
          onChange={(title) => setTraining(data.trainings.find((t) => t.title === title)?.id ?? "")}
        />
      </label>
      {data.canManage && (
        <label>
          <span>Person</span>
          <ScheduleSelect
            label="Person"
            value={personName}
            options={data.people.map((p) => p.name)}
            onChange={(name) => setPerson(data.people.find((p) => p.name === name)?.id ?? data.currentUserId)}
          />
        </label>
      )}
      <label>
        <span>Abgeschlossen am</span>
        <ScheduleDatePicker label="Abgeschlossen am" value={completedOn} onChange={setCompletedOn} />
      </label>
      <DocumentFileField
        label="Zertifikat (optional)"
        types={CERTIFICATE_TYPES}
        prompt="PDF oder Bild auswählen"
        hint="oder hierher ziehen · PDF, JPG, PNG, WebP · höchstens 4 MB"
        typeError="Bitte ein PDF oder ein Bild (JPG, PNG, WebP) auswählen."
        file={file}
        onChange={setFile}
        onError={setError}
      />
      <label className="area-editor-wide">
        <span>Bemerkung</span>
        <input
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
          placeholder="z. B. Kursanbieter, Punktzahl"
        />
      </label>
      {selected?.validForMonths && (
        <p className="area-editor-wide list-hint">Gültigkeit: {selected.validForMonths} Monate ab Abschlussdatum.</p>
      )}
    </EditorDialog>
  );
}
