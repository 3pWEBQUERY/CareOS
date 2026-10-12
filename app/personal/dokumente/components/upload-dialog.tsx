"use client";

import { useState } from "react";
import { EditorDialog } from "@/app/components/workspace-ui";
import { DOCUMENT_CATEGORIES, DOCUMENT_TYPES, type DocumentsPayload } from "@/lib/documents-shared";
import { ScheduleDatePicker, ScheduleSelect } from "@/app/betrieb/components/operations-ui";
import { addDays, postForm } from "./documents-utils";
import DocumentFileField from "@/app/bewohner/components/document-file-field";

export function UploadDialog({
  data,
  onClose,
  onSaved,
}: {
  data: DocumentsPayload;
  onClose: () => void;
  onSaved: (message: string, id?: string) => void;
}) {
  const standards = data.kind === "standard";
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[data.kind][0]);
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState(false);
  const [requiresAck, setRequiresAck] = useState(true);
  const [reviewDueOn, setReviewDueOn] = useState(addDays(data.today, 730));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="document-upload"
      eyebrow={standards ? "Dokumente · Standards" : "Dokumente · Ablage"}
      title={standards ? "Weisung veröffentlichen" : "Dokument hochladen"}
      description={
        standards
          ? "Freigegebene Standards sind verbindlich. Mit Lesebestätigung erhalten alle Mitarbeitenden eine Benachrichtigung."
          : "PDF, Word, Excel, PowerPoint, Text oder Bild bis 4 MB."
      }
      onClose={onClose}
      onSubmit={async () => {
        if (!file) {
          setError("Bitte eine Datei auswählen.");
          return;
        }
        setSaving(true);
        setError("");
        try {
          const form = new FormData();
          form.set("kind", data.kind);
          form.set("title", title);
          form.set("category", category);
          form.set("description", description);
          form.set("status", draft ? "draft" : "active");
          if (standards) {
            form.set("requiresAck", String(requiresAck));
            form.set("reviewDueOn", reviewDueOn);
          }
          if (file) form.set("file", file);
          const result = await postForm("/api/documents", form);
          onSaved(
            draft ? "Entwurf gespeichert" : standards ? "Standard veröffentlicht" : "Dokument hochgeladen",
            result.id,
          );
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel={draft ? "Als Entwurf speichern" : standards ? "Freigeben & veröffentlichen" : "Hochladen"}
    >
      <DocumentFileField
        label="Datei"
        types={DOCUMENT_TYPES}
        prompt="Datei auswählen"
        hint="oder hierher ziehen · PDF, Word, Excel, PowerPoint, Text oder Bild · höchstens 4 MB"
        typeError="Bitte ein PDF, ein Office-Dokument, eine Textdatei oder ein Bild auswählen."
        file={file}
        onChange={(next) => {
          setFile(next);
          if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
        }}
        onError={setError}
      />
      <label className="area-editor-wide">
        <span>Titel</span>
        <input value={title} maxLength={220} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        <span>Kategorie</span>
        <ScheduleSelect
          label="Kategorie"
          value={category}
          options={[...DOCUMENT_CATEGORIES[data.kind]]}
          onChange={setCategory}
        />
      </label>
      <label>
        <span>Status</span>
        <ScheduleSelect
          label="Status"
          value={draft ? "Entwurf" : standards ? "Freigegeben" : "Aktuell"}
          options={[standards ? "Freigegeben" : "Aktuell", "Entwurf"]}
          onChange={(value) => setDraft(value === "Entwurf")}
        />
      </label>
      {standards && (
        <label>
          <span>Überprüfen bis</span>
          <ScheduleDatePicker label="Überprüfen bis" value={reviewDueOn} onChange={setReviewDueOn} />
        </label>
      )}
      {standards && (
        <fieldset className="duty-assignment-options document-ack-options">
          <legend>Kenntnisnahme</legend>
          <div className="area-service-options">
            <label className={requiresAck ? "selected" : ""}>
              <input type="checkbox" checked={requiresAck} onChange={(event) => setRequiresAck(event.target.checked)} />
              <span>Lesebestätigung verlangen</span>
            </label>
          </div>
        </fieldset>
      )}
      <label className="area-editor-wide">
        <span>Beschreibung</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
    </EditorDialog>
  );
}
