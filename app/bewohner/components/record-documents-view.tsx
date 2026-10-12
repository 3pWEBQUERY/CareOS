"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { CalendarDots, Check, FileText, MagnifyingGlass, Stethoscope } from "@phosphor-icons/react";
import { CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, formatDate } from "@/app/components/workspace-ui";
import { PREVIEW_TYPES, fileSizeLabel, fileTypeLabel } from "@/lib/documents-shared";
import { RESIDENT_DOCUMENT_CATEGORIES } from "@/lib/resident-record-shared";
import DocumentFileField from "./document-file-field";
import type { ResidentRecordState } from "./use-resident-record";
import { useNow } from "@/app/components/use-now";

const WEEK = 7 * 86_400_000;

function UploadDialog({
  residentId,
  residentName,
  onClose,
  onSaved,
}: {
  residentId: string;
  residentName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(RESIDENT_DOCUMENT_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="resident-document-upload"
      eyebrow={`${t.prefix}akte · ${residentName}`}
      title="Dokument hochladen"
      description={`PDF oder Bild (z. B. ein fotografierter Arztbericht), höchstens 4 MB. Das Dokument ist nur in dieser ${t.prefix}akte sichtbar.`}
      onClose={onClose}
      onSubmit={async () => {
        if (!file) {
          setError("Bitte ein PDF oder ein Bild auswählen.");
          return;
        }
        setSaving(true);
        setError("");
        const form = new FormData();
        form.set("title", title);
        form.set("category", category);
        form.set("description", description);
        form.set("file", file);
        const response = await fetch(`/api/residents/${residentId}/documents`, { method: "POST", body: form });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setError(payload?.error ?? "Das Dokument konnte nicht hochgeladen werden.");
          setSaving(false);
          return;
        }
        onSaved(`${title} hochgeladen`);
      }}
      saving={saving}
      error={error}
      submitLabel="Hochladen"
    >
      <DocumentFileField
        file={file}
        onError={setError}
        onChange={(next) => {
          setFile(next);
          if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, ""));
        }}
      />
      <label>
        <span>Titel</span>
        <input required minLength={3} maxLength={220} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        <span>Kategorie</span>
        <CareSelect
          label="Kategorie"
          value={category}
          options={[...RESIDENT_DOCUMENT_CATEGORIES]}
          onChange={setCategory}
        />
      </label>
      <label className="area-editor-wide">
        <span>Beschreibung (optional)</span>
        <textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
    </EditorDialog>
  );
}

export function RecordDocumentsView({ r }: { r: ResidentRecordState }) {
  const now = useNow();
  const t = useTerms();
  const {
    resident,
    onAction,
    contentRef,
    documentSearch,
    setDocumentSearch,
    documentCategory,
    setDocumentCategory,
    visibleDocuments,
    live,
    uploadOpen,
    setUploadOpen,
  } = r;
  const all = live.files.data?.documents ?? [];
  const canWrite = live.files.data?.canWrite ?? false;
  const weekAgo = now - WEEK;
  const isNew = (createdAt: string) => Date.parse(createdAt) > weekAgo;
  const fileUrl = (fileId: string, preview: boolean) => `/api/cloud/files/${fileId}${preview ? "?preview=1" : ""}`;

  return (
    <main className="resident-record-content record-documents-view" ref={contentRef} key="documents">
      <div className="record-subpage-heading">
        <div>
          <span className="record-section-label">{`${t.prefix}akte`}</span>
          <h3>Dokumente</h3>
          <p>Zentrale Ablage für Berichte, Pläne, Formulare und administrative Unterlagen von {resident.name}.</p>
        </div>
        {canWrite && resident.id && (
          <button className="primary-button" type="button" onClick={() => setUploadOpen(true)}>
            <FileText aria-hidden="true" /> Dokument hochladen
          </button>
        )}
      </div>

      <section className="record-view-stats" aria-label="Dokumentenübersicht">
        <div>
          <span>
            <FileText aria-hidden="true" />
          </span>
          <p>
            <small>Dokumente gesamt</small>
            <strong>
              {all.length} Datei{all.length === 1 ? "" : "en"}
            </strong>
          </p>
        </div>
        <div>
          <span>
            <Stethoscope aria-hidden="true" />
          </span>
          <p>
            <small>Arztberichte</small>
            <strong>
              {all.filter((d) => d.category === "Arztberichte").length} Bericht
              {all.filter((d) => d.category === "Arztberichte").length === 1 ? "" : "e"}
            </strong>
          </p>
        </div>
        <div>
          <span>
            <CalendarDots aria-hidden="true" />
          </span>
          <p>
            <small>Neu diese Woche</small>
            <strong>
              {all.filter((d) => isNew(d.createdAt)).length} Datei
              {all.filter((d) => isNew(d.createdAt)).length === 1 ? "" : "en"}
            </strong>
          </p>
        </div>
        <div>
          <span>
            <Check aria-hidden="true" />
          </span>
          <p>
            <small>Zuletzt hinzugefügt</small>
            <strong>{all[0] ? formatDate(all[0].createdAt) : "–"}</strong>
          </p>
        </div>
      </section>

      <section className="record-card document-library" aria-labelledby="document-library-title">
        <div className="record-card-heading">
          <div>
            <span className="record-section-label">Ablage</span>
            <h3 id="document-library-title">Dokumentenbibliothek</h3>
          </div>
          <span>{visibleDocuments.length} angezeigt</span>
        </div>
        <div className="document-toolbar">
          <label className="document-search">
            <MagnifyingGlass aria-hidden="true" />
            <input
              type="search"
              value={documentSearch}
              onChange={(event) => setDocumentSearch(event.target.value)}
              placeholder="Dokumente durchsuchen …"
              aria-label="Dokumente durchsuchen"
            />
          </label>
          <div className="document-category-filter" aria-label="Dokumentkategorie filtern">
            {["Alle", ...RESIDENT_DOCUMENT_CATEGORIES].map((category) => (
              <button
                className={documentCategory === category ? "active" : ""}
                type="button"
                key={category}
                aria-pressed={documentCategory === category}
                onClick={() => setDocumentCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        <div className="document-table-head" aria-hidden="true">
          <span>Dokument</span>
          <span>Hinzugefügt</span>
          <span>Status</span>
          <span>Aktionen</span>
        </div>
        <div className="resident-document-list">
          {visibleDocuments.map((document) => (
            <article className="resident-document-row" key={document.id}>
              <span className="resident-document-icon">
                <FileText aria-hidden="true" />
              </span>
              <div className="resident-document-name">
                <strong>{document.title}</strong>
                <small>
                  {[document.category, fileTypeLabel(document.mimeType), fileSizeLabel(document.sizeBytes)]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              <div className="resident-document-meta">
                <strong>{formatDate(document.createdAt)}</strong>
                <small>{document.uploadedBy ?? "Unbekannt"}</small>
              </div>
              <span className={`document-status ${isNew(document.createdAt) ? "new" : "stable"}`}>
                {isNew(document.createdAt) ? "Neu" : "Aktuell"}
              </span>
              <div className="resident-document-actions">
                {document.fileId && document.mimeType && PREVIEW_TYPES.includes(document.mimeType) && (
                  <a href={fileUrl(document.fileId, true)} target="_blank" rel="noreferrer">
                    Ansehen
                  </a>
                )}
                {document.fileId && (
                  <a href={fileUrl(document.fileId, false)} download>
                    Download
                  </a>
                )}
              </div>
            </article>
          ))}
          {!live.files.loading && visibleDocuments.length === 0 && (
            <div className="document-empty">
              <MagnifyingGlass aria-hidden="true" />
              <strong>{all.length ? "Keine Dokumente gefunden" : "Noch keine Dokumente"}</strong>
              <p>{all.length ? "Suche oder Kategorie anpassen." : "Arztberichte, Formulare und Pläne hier ablegen."}</p>
            </div>
          )}
        </div>
      </section>
      {uploadOpen && resident.id && (
        <UploadDialog
          residentId={resident.id}
          residentName={resident.name}
          onClose={() => setUploadOpen(false)}
          onSaved={(message) => {
            setUploadOpen(false);
            live.files.reload();
            live.summary.reload();
            onAction(message);
          }}
        />
      )}
    </main>
  );
}
