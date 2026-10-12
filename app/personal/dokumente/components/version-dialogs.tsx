"use client";

import { useState } from "react";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";
import { DOCUMENT_CATEGORIES, DOCUMENT_TYPES, type LibraryDocument } from "@/lib/documents-shared";
import { ScheduleDatePicker, ScheduleSelect } from "@/app/betrieb/components/operations-ui";
import { addDays, postForm } from "./documents-utils";
import DocumentFileField from "@/app/bewohner/components/document-file-field";

export function VersionDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: LibraryDocument;
  onClose: () => void;
  onSaved: (message: string, id?: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="document-version"
      eyebrow="Dokumente · Versionen"
      title={`Neue Version: ${doc.title}`}
      description={`Version ${doc.versionNo + 1} ersetzt die aktuelle Version ${doc.versionNo}; frühere Versionen bleiben abrufbar.${doc.kind === "standard" && doc.requiresAck ? " Alle müssen die neue Version erneut bestätigen." : ""}`}
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
          if (file) form.set("file", file);
          form.set("changeNote", note);
          form.set("status", draft ? "draft" : "active");
          const result = await postForm(`/api/documents/${doc.id}`, form);
          onSaved(
            draft ? "Neue Version als Entwurf gespeichert" : `Version ${doc.versionNo + 1} veröffentlicht`,
            result.id,
          );
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel={draft ? "Als Entwurf speichern" : "Version veröffentlichen"}
    >
      <DocumentFileField
        label="Datei"
        types={DOCUMENT_TYPES}
        prompt="Neue Fassung auswählen"
        hint="oder hierher ziehen · PDF, Word, Excel, PowerPoint, Text oder Bild · höchstens 4 MB"
        typeError="Bitte ein PDF, ein Office-Dokument, eine Textdatei oder ein Bild auswählen."
        file={file}
        onChange={setFile}
        onError={setError}
      />
      <label className="area-editor-wide">
        <span>Was hat sich geändert?</span>
        <textarea rows={3} maxLength={1000} required value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label>
        <span>Status</span>
        <ScheduleSelect
          label="Status"
          value={draft ? "Entwurf" : "Sofort gültig"}
          options={["Sofort gültig", "Entwurf"]}
          onChange={(value) => setDraft(value === "Entwurf")}
        />
      </label>
    </EditorDialog>
  );
}

export function EditDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: LibraryDocument;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category);
  const [description, setDescription] = useState(doc.description ?? "");
  const [requiresAck, setRequiresAck] = useState(doc.requiresAck);
  const [reviewDueOn, setReviewDueOn] = useState(doc.reviewDueOn ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const standards = doc.kind === "standard";
  return (
    <EditorDialog
      id="document-edit"
      eyebrow="Dokumente"
      title="Angaben bearbeiten"
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await requestJson(`/api/documents/${doc.id}`, {
            method: "POST",
            body: { action: "update", title, category, description, requiresAck, reviewDueOn: reviewDueOn || null },
          });
          onSaved("Angaben gespeichert");
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
        <span>Titel</span>
        <input value={title} maxLength={220} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        <span>Kategorie</span>
        <ScheduleSelect
          label="Kategorie"
          value={category}
          options={[...DOCUMENT_CATEGORIES[doc.kind]]}
          onChange={setCategory}
        />
      </label>
      {standards && (
        <label>
          <span>Überprüfen bis</span>
          <ScheduleDatePicker
            label="Überprüfen bis"
            value={reviewDueOn || addDays(doc.createdAt.slice(0, 10), 730)}
            onChange={setReviewDueOn}
          />
        </label>
      )}
      {standards && (
        <fieldset className="area-editor-wide duty-assignment-options">
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
