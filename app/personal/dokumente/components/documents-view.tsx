"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  LoadError,
  ReasonDialog,
  formatDate,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  DOCUMENT_CATEGORIES,
  fileSizeLabel,
  fileTypeLabel,
  type DocumentKind,
  type DocumentsPayload,
  type LibraryDocument,
} from "@/lib/documents-shared";
import { PersonalSummary, SearchField } from "../../components/personal-ui";
import { Folder, current, addDays, statusOf, fileIcon, fileUrl, Dialog } from "./documents-utils";
import { UploadDialog } from "./upload-dialog";
import { VersionDialog, EditDialog } from "./version-dialogs";
import { DocumentPreview } from "./document-preview";

export function DocumentsView({
  kind,
  showToast,
  dialog,
  setDialog,
  onData,
}: {
  kind: DocumentKind;
  showToast: ShowToast;
  dialog: Dialog | null;
  setDialog: (dialog: Dialog | null) => void;
  onData: (data: DocumentsPayload | undefined) => void;
}) {
  const standards = kind === "standard";
  const params = useSearchParams();
  const [folder, setFolder] = useState("all");
  const [filter, setFilter] = useState("Alle");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("document"));
  const library = useApiData<DocumentsPayload>(`/api/documents?kind=${kind}`);
  const { reload } = library;
  const data = library.data;
  useEffect(() => onData(data), [data, onData]);
  const today = data?.today ?? "";
  const docs = data?.documents ?? [];
  const me = data?.currentUserId;

  const folders: Folder[] = standards
    ? [
        {
          id: "all",
          label: "Alle Standards",
          detail: "verbindliche Versionen",
          icon: "quality",
          match: (d) => d.status === "active",
        },
        {
          id: "ack",
          label: "Zu bestätigen",
          detail: "Lesebestätigung offen",
          icon: "check",
          match: (d) => d.status === "active" && d.requiresAck && !d.acknowledgedAt,
        },
        {
          id: "review",
          label: "Zur Prüfung",
          detail: "Entwürfe & fällige Überprüfung",
          icon: "alert",
          match: (d) =>
            d.status === "draft" || (d.status === "active" && !!d.reviewDueOn && d.reviewDueOn <= addDays(today, 30)),
        },
        { id: "archive", label: "Archiv", detail: "Frühere Versionen", icon: "building", match: (d) => !current(d) },
      ]
    : [
        {
          id: "all",
          label: "Alle Dokumente",
          detail: "aktuelle Dateien",
          icon: "docs",
          match: (d) => d.status === "active",
        },
        {
          id: "mine",
          label: "Meine Dokumente",
          detail: "von dir hochgeladen",
          icon: "note",
          match: (d) => current(d) && d.uploadedById === me,
        },
        ...DOCUMENT_CATEGORIES.document.map((category): Folder => ({
          id: category,
          label: category,
          detail: "Kategorie",
          icon: category === "Notfall" ? "alert" : category === "Organisation" ? "building" : "docs",
          match: (d) => current(d) && d.category === category,
        })),
        { id: "archive", label: "Archiv", detail: "Frühere Versionen", icon: "building", match: (d) => !current(d) },
      ];
  const activeFolder = folders.find((f) => f.id === folder) ?? folders[0];
  const filters = standards
    ? ["Alle", ...DOCUMENT_CATEGORIES.standard]
    : ["Alle", "Aktuell", "Entwurf", "PDF", "Word", "Excel", "Bild"];
  const needle = query.trim().toLocaleLowerCase("de-CH");
  const visible = docs
    .filter(activeFolder.match)
    .filter((d) => {
      if (filter === "Alle") return true;
      if (standards) return d.category === filter;
      if (filter === "Aktuell") return d.status === "active";
      if (filter === "Entwurf") return d.status === "draft";
      return fileTypeLabel(d.mimeType) === filter;
    })
    .filter(
      (d) =>
        !needle ||
        `${d.title} ${d.description ?? ""} ${d.category} ${d.fileName ?? ""}`
          .toLocaleLowerCase("de-CH")
          .includes(needle),
    );
  const selected = docs.find((d) => d.id === selectedId) ?? visible[0] ?? null;
  const versions: LibraryDocument[] = [];
  for (let d = selected; d?.previousId;) {
    const previous = docs.find((x) => x.id === d!.previousId);
    if (!previous) break;
    versions.push(previous);
    d = previous;
  }

  const run = async (url: string, body: unknown, message?: string) => {
    try {
      await requestJson(url, { method: "POST", body });
      if (message) showToast(message);
      reload();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    }
  };
  const markRead = (d: LibraryDocument) => {
    if (!d.readAt) void run(`/api/documents/${d.id}`, { action: "read" });
  };
  const done = (message: string, id?: string) => {
    setDialog(null);
    showToast(message);
    if (id) setSelectedId(id);
    reload();
  };

  const activeDocs = docs.filter((d) => d.status === "active");
  return (
    <>
      <PersonalSummary
        items={
          standards
            ? [
                { icon: "docs", value: String(activeDocs.length), label: "Standards" },
                {
                  icon: "check",
                  value: String(activeDocs.filter((d) => !d.requiresAck || d.acknowledgedAt).length),
                  label: "von dir bestätigt",
                  tone: "info",
                },
                {
                  icon: "alert",
                  value: String(activeDocs.filter((d) => d.requiresAck && !d.acknowledgedAt).length),
                  label: "zu bestätigen",
                  tone: "attention",
                },
                {
                  icon: "alert",
                  value: String(activeDocs.filter((d) => d.reviewDueOn && d.reviewDueOn < today).length),
                  label: "Überprüfung überfällig",
                  tone: "critical",
                },
              ]
            : [
                { icon: "docs", value: String(activeDocs.length), label: "Dokumente" },
                {
                  icon: "check",
                  value: String(activeDocs.filter((d) => d.readAt).length),
                  label: "von dir geöffnet",
                  tone: "info",
                },
                {
                  icon: "note",
                  value: String(docs.filter((d) => d.status === "draft").length),
                  label: "Entwürfe",
                  tone: "attention",
                },
                {
                  icon: "team",
                  value: String(docs.filter((d) => current(d) && d.uploadedById === me).length),
                  label: "von dir hochgeladen",
                },
              ]
        }
      />
      {library.error && <LoadError message={library.error} onRetry={reload} />}
      <div className={`documents-layout ${standards ? "documents-standards-layout" : "documents-library-layout"}`}>
        <aside className="card documents-folders">
          <div className="card-header">
            <div>
              <p className="eyebrow">{standards ? "Standardsammlung" : "Ablage"}</p>
              <h2 className="card-title">{standards ? "Weisungen" : "Dokumente"}</h2>
            </div>
          </div>
          {folders.map((f) => (
            <button
              className={`documents-folder ${f.id === activeFolder.id ? "active" : ""}`}
              type="button"
              key={f.id}
              aria-pressed={f.id === activeFolder.id}
              onClick={() => {
                setFolder(f.id);
                setSelectedId(null);
              }}
            >
              <ModuleIcon name={f.icon} />
              <span>
                <strong>{f.label}</strong>
                <small>{f.detail}</small>
              </span>
              <b>{docs.filter(f.match).length}</b>
            </button>
          ))}
        </aside>
        <section className="card documents-library">
          <div className="documents-library-header">
            <div>
              <p className="eyebrow">{standards ? "Versionen und Freigaben" : "Dateibibliothek"}</p>
              <h2 className="card-title">{activeFolder.label}</h2>
              <p className="card-subtitle">
                {visible.length} von {docs.filter(activeFolder.match).length} Dateien sichtbar
              </p>
            </div>
            <div className="documents-library-actions">
              <SearchField
                label={standards ? "Standards durchsuchen" : "Dokumente durchsuchen"}
                query={query}
                setQuery={setQuery}
                placeholder={standards ? "Standards suchen…" : "Dokumente suchen…"}
              />
              {data?.canUpload && (
                <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "upload" })}>
                  <ModuleIcon name="plus" /> {standards ? "Veröffentlichen" : "Hochladen"}
                </button>
              )}
            </div>
          </div>
          <div className="documents-filter-row operations-filter-buttons">
            {filters.map((item) => (
              <button
                className={filter === item ? "active" : ""}
                type="button"
                key={item}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="documents-table-head">
            <span>{standards ? "Standard" : "Name"}</span>
            <span>{standards ? "Freigabe" : "Zuletzt geändert"}</span>
            <span>Status</span>
            <span />
          </div>
          <div className="documents-table">
            {visible.map((d) => {
              const status = statusOf(d, today);
              const url = fileUrl(d);
              return (
                <article className={selected?.id === d.id ? "selected" : ""} key={d.id}>
                  <button className="documents-row-main" type="button" onClick={() => setSelectedId(d.id)}>
                    <span className={`documents-file-icon ${status.tone}`}>
                      <ModuleIcon name={fileIcon(d)} />
                    </span>
                    <span>
                      <strong>{d.title}</strong>
                      <small>{d.description ?? `${d.category} · Version ${d.versionNo}`}</small>
                    </span>
                  </button>
                  <span className="documents-row-meta">
                    {standards
                      ? d.approvedAt
                        ? `Freigegeben ${formatDate(d.approvedAt)} · V${d.versionNo}`
                        : `Entwurf · V${d.versionNo}`
                      : [fileTypeLabel(d.mimeType), fileSizeLabel(d.sizeBytes), formatDate(d.createdAt)]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
                  <span className={`status-badge ${status.tone}`}>{status.label}</span>
                  {url ? (
                    <a
                      className="quiet-button"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => {
                        setSelectedId(d.id);
                        markRead(d);
                      }}
                    >
                      Öffnen
                    </a>
                  ) : (
                    <button className="quiet-button" type="button" onClick={() => setSelectedId(d.id)}>
                      Details
                    </button>
                  )}
                </article>
              );
            })}
            {data && visible.length === 0 && (
              <div className="resident-empty">
                <ModuleIcon name={docs.length ? "search" : "docs"} />
                <strong>
                  {docs.length
                    ? "Keine Dokumente gefunden"
                    : standards
                      ? "Noch keine Standards"
                      : "Noch keine Dokumente"}
                </strong>
                <p>
                  {docs.length
                    ? "Ordner, Suchbegriff oder Filter anpassen."
                    : "Über „Hochladen“ legst du das erste Dokument ab."}
                </p>
              </div>
            )}
            {!data && library.loading && <p className="list-hint">Dokumente werden geladen …</p>}
          </div>
        </section>
        <aside className="card documents-preview">
          {selected ? (
            <DocumentPreview
              doc={selected}
              data={data!}
              versions={versions}
              today={today}
              onOpen={() => markRead(selected)}
              onAck={() =>
                void run(`/api/documents/${selected.id}`, { action: "ack" }, "Gelesen & verstanden bestätigt")
              }
              onPublish={() => void run(`/api/documents/${selected.id}`, { action: "publish" }, "Freigegeben")}
              setDialog={setDialog}
            />
          ) : (
            <div className="card-header">
              <div>
                <p className="eyebrow">{standards ? "Freigabedetail" : "Vorschau"}</p>
                <h2 className="card-title">Kein Dokument ausgewählt</h2>
              </div>
            </div>
          )}
        </aside>
      </div>
      {data && dialog?.kind === "upload" && <UploadDialog data={data} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "version" && <VersionDialog doc={dialog.doc} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "edit" && <EditDialog doc={dialog.doc} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "archive" && (
        <ReasonDialog
          eyebrow="Dokumente"
          title={standards ? "Standard archivieren" : "Dokument archivieren"}
          description={`„${dialog.doc.title}“ wird ins Archiv verschoben und ist nicht mehr gültig. Es bleibt nachvollziehbar.`}
          label="Grund"
          placeholder="z. B. ersetzt durch neue Vorlage, nicht mehr in Gebrauch"
          submitLabel="Archivieren"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/documents/${dialog.doc.id}`, {
              method: "POST",
              body: { action: "archive", reason },
            });
            done("Ins Archiv verschoben");
          }}
        />
      )}
    </>
  );
}
