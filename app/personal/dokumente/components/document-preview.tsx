"use client";

import { ModuleIcon } from "@/app/components/module-icon";
import { formatDate } from "@/app/components/workspace-ui";
import { fileSizeLabel, fileTypeLabel, type DocumentsPayload, type LibraryDocument } from "@/lib/documents-shared";
import { current, statusOf, fileIcon, fileUrl, Dialog } from "./documents-utils";

export function DocumentPreview({
  doc,
  data,
  versions,
  today,
  onOpen,
  onAck,
  onPublish,
  setDialog,
}: {
  doc: LibraryDocument;
  data: DocumentsPayload;
  versions: LibraryDocument[];
  today: string;
  onOpen: () => void;
  onAck: () => void;
  onPublish: () => void;
  setDialog: (dialog: Dialog) => void;
}) {
  const standards = doc.kind === "standard";
  const status = statusOf(doc, today);
  const url = fileUrl(doc);
  const canPublish = doc.status === "draft" && doc.canEdit && (!standards || data.canManage);
  return (
    <>
      <div className="card-header">
        <div>
          <p className="eyebrow">{standards ? "Freigabedetail" : "Vorschau"}</p>
          <h2 className="card-title">{doc.title}</h2>
          <p className="card-subtitle">
            {doc.category} · Version {doc.versionNo}
          </p>
        </div>
        <span className={`documents-preview-badge ${status.tone}`}>
          <ModuleIcon name={fileIcon(doc)} />
        </span>
      </div>
      <div className="documents-preview-page">
        <ModuleIcon name={standards ? "quality" : "docs"} />
        <strong>{doc.fileName ?? "Keine Datei hinterlegt"}</strong>
        <small>{doc.description ?? "Keine Beschreibung."}</small>
        <span>
          {[fileTypeLabel(doc.mimeType), fileSizeLabel(doc.sizeBytes)].filter(Boolean).join(" · ")} · hochgeladen{" "}
          {formatDate(doc.createdAt)}
          {doc.uploadedByName ? ` von ${doc.uploadedByName}` : ""}
        </span>
      </div>
      <dl className="documents-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`status-badge ${status.tone}`}>{status.label}</span>
          </dd>
        </div>
        {standards && (
          <div>
            <dt>Freigabe</dt>
            <dd>
              {doc.approvedAt
                ? `${formatDate(doc.approvedAt)} · ${doc.approvedByName ?? "Qualitätsmanagement"}`
                : "ausstehend"}
            </dd>
          </div>
        )}
        {standards && doc.reviewDueOn && (
          <div>
            <dt>Überprüfen bis</dt>
            <dd className={doc.reviewDueOn < today ? "overdue" : ""}>{formatDate(doc.reviewDueOn)}</dd>
          </div>
        )}
        {standards && doc.requiresAck && (
          <div>
            <dt>Kenntnisnahme</dt>
            <dd>
              {doc.acknowledgedAt
                ? `Von dir bestätigt am ${formatDate(doc.acknowledgedAt)}`
                : "Von dir noch nicht bestätigt"}
              {data.canManage ? ` · ${doc.ackCount}/${data.audience} im Team` : ""}
            </dd>
          </div>
        )}
        {doc.changeNote && (
          <div>
            <dt>Änderung</dt>
            <dd>{doc.changeNote}</dd>
          </div>
        )}
        {doc.archiveReason && (
          <div>
            <dt>Archiviert</dt>
            <dd>{doc.archiveReason}</dd>
          </div>
        )}
        {versions.length > 0 && (
          <div>
            <dt>Frühere Versionen</dt>
            <dd className="documents-versions">
              {versions.map((v) =>
                fileUrl(v) ? (
                  <a key={v.id} href={fileUrl(v)!} target="_blank" rel="noreferrer">
                    Version {v.versionNo} · {formatDate(v.createdAt)}
                  </a>
                ) : (
                  <span key={v.id}>Version {v.versionNo}</span>
                ),
              )}
            </dd>
          </div>
        )}
      </dl>
      {url ? (
        <a className="primary-button" href={url} target="_blank" rel="noreferrer" onClick={onOpen}>
          {standards ? "Standard öffnen" : "Dokument öffnen"}
        </a>
      ) : (
        <button className="primary-button" type="button" disabled>
          Keine Datei hinterlegt
        </button>
      )}
      <div className="documents-preview-actions">
        {standards && doc.status === "active" && doc.requiresAck && !doc.acknowledgedAt && (
          <button className="secondary-button" type="button" onClick={onAck}>
            Gelesen & verstanden
          </button>
        )}
        {canPublish && (
          <button className="secondary-button" type="button" onClick={onPublish}>
            Freigeben
          </button>
        )}
        {doc.canEdit && current(doc) && (
          <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "version", doc })}>
            Neue Version
          </button>
        )}
        {doc.canEdit && current(doc) && (
          <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "edit", doc })}>
            Bearbeiten
          </button>
        )}
        {doc.canEdit && current(doc) && (
          <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "archive", doc })}>
            Archivieren
          </button>
        )}
      </div>
    </>
  );
}
