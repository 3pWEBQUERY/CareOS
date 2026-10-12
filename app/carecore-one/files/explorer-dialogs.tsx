"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretRight, DownloadSimple, HouseLine, UsersThree, X } from "@phosphor-icons/react";
import { EditorDialog } from "@/app/components/workspace-ui";
import {
  NEW_DOCUMENTS,
  fileKind,
  isTextEditable,
  prettyBytes,
  type ExplorerFile,
  type FileScope,
  type FolderNode,
  type NewDocumentKind,
} from "@/lib/files-shared";
import { OFFICE_TEMPLATES, OFFICE_TYPES, type OfficeKind, type OfficeTemplate } from "@/lib/office/model";
import { call, fileUrl, loadTree, download } from "./explorer-api";
import { FileIcon, FolderIcon } from "./file-icon";

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : "Das hat nicht geklappt.");

// Name eingeben (neuer Ordner, umbenennen); Endung bleibt beim Umbenennen erhalten, wenn sie fehlt.
export function NameDialog({
  title,
  eyebrow,
  label,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  eyebrow: string;
  label: string;
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="files-name"
      eyebrow={eyebrow}
      title={title}
      onClose={onClose}
      saving={saving}
      error={error}
      submitLabel={submitLabel}
      onSubmit={async () => {
        if (!name.trim()) return setError("Bitte einen Namen eingeben.");
        setSaving(true);
        setError("");
        try {
          await onSubmit(name.trim());
        } catch (cause) {
          setError(errorText(cause));
          setSaving(false);
        }
      }}
    >
      <label className="area-editor-wide">
        <span>{label}</span>
        <input
          autoFocus
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => {
            // Wie im Explorer: nur den Namen ohne Endung markieren.
            const dot = event.target.value.lastIndexOf(".");
            event.target.setSelectionRange(0, dot > 0 ? dot : event.target.value.length);
          }}
        />
      </label>
    </EditorDialog>
  );
}

export function NewDocumentDialog({
  initialKind,
  onSubmit,
  onClose,
}: {
  initialKind: NewDocumentKind;
  onSubmit: (kind: NewDocumentKind, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<NewDocumentKind>(initialKind);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="files-document"
      eyebrow="Ablage · Neu"
      title="Neue einfache Datei"
      description="Entsteht im geöffneten Ordner und lässt sich gleich hier bearbeiten. Jede Speicherung bleibt als Version erhalten."
      onClose={onClose}
      saving={saving}
      error={error}
      submitLabel="Erstellen und öffnen"
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await onSubmit(kind, name.trim() || NEW_DOCUMENTS[kind].label);
        } catch (cause) {
          setError(errorText(cause));
          setSaving(false);
        }
      }}
    >
      <fieldset className="area-editor-wide files-kind-picker">
        <legend>Art</legend>
        <div role="group" aria-label="Art">
          {(Object.keys(NEW_DOCUMENTS) as NewDocumentKind[]).map((item) => (
            <button
              key={item}
              type="button"
              className={kind === item ? "active" : ""}
              aria-pressed={kind === item}
              onClick={() => setKind(item)}
            >
              <FileIcon file={{ name: `x.${NEW_DOCUMENTS[item].extension}`, mimeType: NEW_DOCUMENTS[item].mimeType }} />
              <span>
                <strong>{NEW_DOCUMENTS[item].label}</strong>
                <small>.{NEW_DOCUMENTS[item].extension}</small>
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <label className="area-editor-wide">
        <span>Name</span>
        <input
          autoFocus
          maxLength={200}
          value={name}
          placeholder={`z. B. ${kind === "list" ? "Inventar Wäsche" : kind === "note" ? "Protokoll Teamsitzung" : "Merkblatt Besuchszeiten"}`}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
    </EditorDialog>
  );
}

// Kleine Vorschau einer Vorlage (gezeichnet, keine Bilder): Seite, Tabelle oder Folie.
function TemplatePreview({ template }: { template: OfficeTemplate }) {
  if (template.kind === "sheet") {
    const header = template.id !== "sheet-blank";
    return (
      <span className={`files-template-preview sheet ${template.id}`} aria-hidden="true">
        {Array.from({ length: 6 }, (_, row) => (
          <span key={row} className={row === 0 && header ? "head" : ""}>
            {Array.from({ length: 4 }, (_, col) => (
              <i
                key={col}
                className={header && row > 0 && col === 3 && template.id !== "sheet-attendance" ? "formula" : ""}
              />
            ))}
          </span>
        ))}
      </span>
    );
  }
  if (template.kind === "deck") {
    return (
      <span className={`files-template-preview deck ${template.id}`} aria-hidden="true">
        <b />
        <em />
        <small />
      </span>
    );
  }
  const lines: Record<string, string[]> = {
    "document-blank": [],
    "document-minutes": ["h1", "table", "h2", "p", "h2", "li", "li", "h2", "table"],
    "document-leaflet": ["h1 center", "p center short", "rule", "h2", "p", "h2", "li", "li"],
    "document-letter": ["gap", "gap", "p right short", "p short", "gap", "p", "p", "p short"],
    "document-checklist": ["h1", "p short", "h2", "check", "check", "h2", "check", "check"],
  };
  return (
    <span className={`files-template-preview doc ${template.id}`} aria-hidden="true">
      {(lines[template.id] ?? []).map((line, index) => (
        <i key={index} className={line} />
      ))}
    </span>
  );
}

// „Neu“ → Dokument, Tabelle oder Präsentation: Vorlage wählen, Namen geben, im Editor öffnen.
export function NewOfficeDialog({
  initialKind,
  onSubmit,
  onClose,
}: {
  initialKind: OfficeKind;
  onSubmit: (template: OfficeTemplate, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<OfficeKind>(initialKind);
  const [templateId, setTemplateId] = useState(`${initialKind}-blank`);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const templates = OFFICE_TEMPLATES.filter((item) => item.kind === kind);
  const template = OFFICE_TEMPLATES.find((item) => item.id === templateId) ?? templates[0];
  return (
    <EditorDialog
      id="files-office"
      eyebrow="Ablage · Neu"
      title={
        kind === "document"
          ? "Neues Dokument (Word)"
          : kind === "sheet"
            ? "Neue Tabelle (Excel)"
            : "Neue Präsentation (PowerPoint)"
      }
      description="Entsteht im geöffneten Ordner als echte Office-Datei und öffnet sich gleich im Editor. Änderungen werden automatisch gespeichert."
      onClose={onClose}
      saving={saving}
      error={error}
      submitLabel="Erstellen und öffnen"
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await onSubmit(template, name.trim());
        } catch (cause) {
          setError(errorText(cause));
          setSaving(false);
        }
      }}
    >
      <div className="area-editor-wide files-office-kinds" role="tablist" aria-label="Art">
        {(Object.keys(OFFICE_TYPES) as OfficeKind[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={kind === item}
            className={kind === item ? "active" : ""}
            onClick={() => {
              setKind(item);
              setTemplateId(`${item}-blank`);
            }}
          >
            <FileIcon file={{ name: `x.${OFFICE_TYPES[item].extension}`, mimeType: OFFICE_TYPES[item].mimeType }} />
            <span>
              <strong>{OFFICE_TYPES[item].label}</strong>
              <small>.{OFFICE_TYPES[item].extension}</small>
            </span>
          </button>
        ))}
      </div>
      <fieldset className="area-editor-wide files-templates">
        <legend>Vorlage</legend>
        <div role="radiogroup" aria-label="Vorlage">
          {templates.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={template.id === item.id}
              className={template.id === item.id ? "active" : ""}
              onClick={() => setTemplateId(item.id)}
            >
              <TemplatePreview template={item} />
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </button>
          ))}
        </div>
      </fieldset>
      <label className="area-editor-wide">
        <span>Name</span>
        <input
          maxLength={200}
          value={name}
          placeholder={template.name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
    </EditorDialog>
  );
}

type TreeNode = FolderNode & { children: TreeNode[] };

function buildTree(folders: FolderNode[]) {
  const nodes = new Map<string, TreeNode>(folders.map((folder) => [folder.id, { ...folder, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of nodes.values())
    (node.parentId && nodes.get(node.parentId) ? nodes.get(node.parentId)!.children : roots).push(node);
  return roots;
}

// Ziel für „Verschieben“ oder „Kopieren“: Ordnerbaum der Ablage; Ordner der Auswahl selbst sind gesperrt.
export function FolderPickerDialog({
  scope,
  mode,
  count,
  blocked,
  current,
  onSubmit,
  onClose,
}: {
  scope: FileScope;
  mode: "move" | "copy";
  count: number;
  blocked: string[];
  current: string | null;
  onSubmit: (folderId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [folders, setFolders] = useState<FolderNode[] | null>(null);
  const [target, setTarget] = useState<string | null>(current);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    loadTree(scope)
      .then((list) => {
        setFolders(list);
        // Pfad zum aktuellen Ordner aufklappen.
        const byId = new Map(list.map((folder) => [folder.id, folder]));
        const expanded = new Set<string>();
        for (let id = current; id; id = byId.get(id)?.parentId ?? null) expanded.add(id);
        setOpen(expanded);
      })
      .catch((cause) => setError(errorText(cause)));
  }, [scope, current]);
  const tree = useMemo(() => buildTree(folders ?? []), [folders]);
  const blockedSet = useMemo(() => {
    const result = new Set(blocked);
    for (let grew = true; grew;) {
      grew = false;
      for (const folder of folders ?? [])
        if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
          result.add(folder.id);
          grew = true;
        }
    }
    return result;
  }, [blocked, folders]);
  const renderNode = (node: TreeNode, depth: number) => {
    const expanded = open.has(node.id);
    const disabled = blockedSet.has(node.id);
    return (
      <li key={node.id}>
        <div className={`files-tree-row ${target === node.id ? "active" : ""}`} style={{ paddingLeft: 8 + depth * 18 }}>
          <button
            type="button"
            className="files-tree-toggle"
            aria-label={expanded ? `${node.name} zuklappen` : `${node.name} aufklappen`}
            disabled={!node.children.length}
            onClick={() =>
              setOpen((current) => {
                const next = new Set(current);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              })
            }
          >
            {node.children.length ? expanded ? <CaretDown /> : <CaretRight /> : null}
          </button>
          <button
            type="button"
            className="files-tree-label"
            disabled={disabled}
            aria-pressed={target === node.id}
            onClick={() => setTarget(node.id)}
          >
            <FolderIcon />
            {node.name}
          </button>
        </div>
        {expanded && node.children.length > 0 && <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <EditorDialog
      id="files-picker"
      eyebrow={mode === "move" ? "Ablage · Verschieben" : "Ablage · Kopieren"}
      title={`${count === 1 ? "Element" : `${count} Elemente`} ${mode === "move" ? "verschieben" : "kopieren"} nach …`}
      description={
        mode === "move"
          ? "Gleiche Namen am Ziel erhalten automatisch eine Nummer."
          : "Die Kopie ist eine eigene Datei mit eigenen Versionen."
      }
      onClose={onClose}
      saving={saving}
      error={error}
      submitLabel={mode === "move" ? "Hierher verschieben" : "Hierher kopieren"}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await onSubmit(target);
        } catch (cause) {
          setError(errorText(cause));
          setSaving(false);
        }
      }}
    >
      <div className="area-editor-wide files-tree" role="tree" aria-label="Zielordner">
        <div className={`files-tree-row ${target === null ? "active" : ""}`}>
          <span className="files-tree-toggle" />
          <button
            type="button"
            className="files-tree-label"
            aria-pressed={target === null}
            onClick={() => setTarget(null)}
          >
            {scope === "shared" ? <UsersThree weight="duotone" /> : <HouseLine weight="duotone" />}
            {scope === "shared" ? "Gemeinsame Ablage" : "Meine Dateien"}
          </button>
        </div>
        {folders === null ? (
          <p className="list-hint">Ordner werden geladen …</p>
        ) : (
          <ul>{tree.map((node) => renderNode(node, 1))}</ul>
        )}
      </div>
    </EditorDialog>
  );
}

export type ConflictChoice = "replace" | "keep" | "skip";

// Gleicher Name im Ordner: ersetzen (neue Version), beide behalten oder überspringen.
export function ConflictDialog({
  name,
  remaining,
  canReplace,
  onChoose,
}: {
  name: string;
  remaining: number;
  canReplace: boolean;
  onChoose: (choice: ConflictChoice, forAll: boolean) => void;
}) {
  const [forAll, setForAll] = useState(false);
  return (
    <EditorDialog
      id="files-conflict"
      eyebrow="Ablage · Hochladen"
      title="Datei gibt es bereits"
      description={`„${name}“ liegt schon in diesem Ordner.${canReplace ? " Ersetzen legt eine neue Version an – die bisherige Fassung bleibt in den Versionen erhalten." : " Ersetzen dürfen die Person, die sie hochgeladen hat, und die Leitung."}`}
      onClose={() => onChoose("skip", false)}
      saving={false}
      error=""
      submitLabel="Beide behalten"
      onSubmit={() => onChoose("keep", forAll)}
      extraActions={
        <>
          <button className="secondary-button" type="button" onClick={() => onChoose("skip", forAll)}>
            Überspringen
          </button>
          {canReplace && (
            <button className="secondary-button" type="button" onClick={() => onChoose("replace", forAll)}>
              Ersetzen
            </button>
          )}
        </>
      }
    >
      {remaining > 0 ? (
        <label className="area-editor-wide files-check">
          <input type="checkbox" checked={forAll} onChange={(event) => setForAll(event.target.checked)} />
          <span>Für die {remaining === 1 ? "nächste Datei" : `nächsten ${remaining} Dateien`} gleich entscheiden</span>
        </label>
      ) : (
        <p className="area-editor-wide list-hint">Beide behalten speichert die neue Datei mit einer Nummer im Namen.</p>
      )}
    </EditorDialog>
  );
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="files-confirm"
      eyebrow="Ablage · Papierkorb"
      title={title}
      onClose={onClose}
      saving={saving}
      error={error}
      danger
      submitLabel={confirmLabel}
      onSubmit={async () => {
        setSaving(true);
        try {
          await onConfirm();
        } catch (cause) {
          setError(errorText(cause));
          setSaving(false);
        }
      }}
    >
      <p className="area-editor-wide files-confirm-text">{text}</p>
    </EditorDialog>
  );
}

// Text, Notiz oder Liste bearbeiten; Strg+S speichert. Ohne Recht nur lesen.
export function TextEditorDialog({
  file,
  onSaved,
  onClose,
}: {
  file: ExplorerFile;
  onSaved: (file: ExplorerFile) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [version, setVersion] = useState(file.versionNo);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  useEffect(() => {
    call<{ content: string; canEdit: boolean; file: ExplorerFile }>(`/api/cloud/files/${file.id}?text=1`)
      .then((result) => {
        setContent(result.content);
        setOriginal(result.content);
        setCanEdit(result.canEdit);
        setVersion(result.file.versionNo);
      })
      .catch((cause) => setError(errorText(cause)));
  }, [file.id]);
  const dirty = content !== null && content !== original;
  async function save() {
    if (content === null || !dirty) return;
    setSaving(true);
    setError("");
    try {
      const result = await call<{ file: ExplorerFile }>(`/api/cloud/files/${file.id}`, {
        method: "PUT",
        json: { content, versionNo: version },
      });
      setOriginal(content);
      setVersion(result.file.versionNo);
      setSavedAt(new Intl.DateTimeFormat("de-CH", { timeStyle: "short" }).format(new Date()));
      onSaved(result.file);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }
  const csv = fileKind(file) === "Liste";
  return (
    <EditorDialog
      id="files-editor"
      eyebrow={`Ablage · ${fileKind(file)}`}
      title={file.name}
      description={
        canEdit
          ? `Version ${version}${savedAt ? ` · gespeichert um ${savedAt}` : ""}${dirty ? " · ungespeicherte Änderungen" : ""}`
          : "Nur lesen – ändern dürfen die Person, die die Datei angelegt hat, und die Leitung."
      }
      onClose={() => (dirty ? setConfirmClose(true) : onClose())}
      saving={saving}
      error={error}
      submitLabel={saving ? "Wird gespeichert …" : "Speichern"}
      onSubmit={canEdit ? save : onClose}
      extraActions={
        confirmClose ? (
          <span className="files-editor-discard" role="alert">
            Änderungen verwerfen?
            <button className="appointment-danger-button" type="button" onClick={onClose}>
              Verwerfen
            </button>
            <button className="secondary-button" type="button" onClick={() => setConfirmClose(false)}>
              Weiter bearbeiten
            </button>
          </span>
        ) : undefined
      }
    >
      {content === null ? (
        <p className="area-editor-wide list-hint">{error ? "" : "Inhalt wird geladen …"}</p>
      ) : (
        <label className="area-editor-wide files-editor">
          <span>{csv ? "Inhalt (eine Zeile je Eintrag, Spalten mit Semikolon trennen)" : "Inhalt"}</span>
          <textarea
            autoFocus={canEdit}
            readOnly={!canEdit}
            spellCheck={!csv}
            className={csv ? "mono" : ""}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                void save();
              }
            }}
          />
        </label>
      )}
    </EditorDialog>
  );
}

type ChatTarget = { id: string; title: string; kind: string };

// Datei im Messenger teilen: Unterhaltung wählen, Nachricht dazu schreiben.
export function ShareToChatDialog({
  files,
  onShared,
  onClose,
}: {
  files: ExplorerFile[];
  onShared: (title: string) => void;
  onClose: () => void;
}) {
  const [chats, setChats] = useState<ChatTarget[] | null>(null);
  const [target, setTarget] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    call<{ conversations: ChatTarget[] }>("/api/conversations?list=1")
      .then((result) => setChats(result.conversations))
      .catch((cause) => setError(errorText(cause)));
  }, []);
  return (
    <EditorDialog
      id="files-share"
      eyebrow="Ablage · Teilen"
      title="Im Messenger teilen"
      description={
        files.some((file) => file.path.startsWith("Meine Dateien"))
          ? "Persönliche Dateien werden als Kopie in die Unterhaltung gestellt; Dateien der gemeinsamen Ablage bleiben verknüpft."
          : "Die Mitglieder öffnen die Datei direkt aus der Unterhaltung."
      }
      onClose={onClose}
      saving={saving}
      error={error}
      submitLabel="Teilen"
      onSubmit={async () => {
        if (!target) return setError("Bitte eine Unterhaltung wählen.");
        setSaving(true);
        setError("");
        try {
          await call("/api/conversations", {
            method: "POST",
            json: {
              action: "message",
              conversationId: target,
              text,
              attachmentIds: files.map((file) => file.id),
            },
          });
          onShared(chats?.find((chat) => chat.id === target)?.title ?? "Unterhaltung");
        } catch (cause) {
          setError(errorText(cause));
          setSaving(false);
        }
      }}
    >
      <div className="area-editor-wide files-share-files">
        {files.map((file) => (
          <span key={file.id}>
            <FileIcon file={file} />
            {file.name}
          </span>
        ))}
      </div>
      <fieldset className="area-editor-wide files-share-targets">
        <legend>Unterhaltung</legend>
        {chats === null ? (
          <p className="list-hint">Unterhaltungen werden geladen …</p>
        ) : chats.length ? (
          <div role="group" aria-label="Unterhaltung">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={`day-toggle ${target === chat.id ? "active" : ""}`}
                aria-pressed={target === chat.id}
                onClick={() => setTarget(chat.id)}
              >
                {chat.title}
              </button>
            ))}
          </div>
        ) : (
          <p className="list-hint">Noch keine Unterhaltung – im Messenger eine Nachricht oder Gruppe beginnen.</p>
        )}
      </fieldset>
      <label className="area-editor-wide">
        <span>Nachricht (optional)</span>
        <textarea rows={3} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
    </EditorDialog>
  );
}

// Vorschau: Bilder, PDF, Video, Audio direkt; Text, Notiz und Liste als Text; sonst Download.
export function PreviewDialog({
  file,
  onEdit,
  onClose,
}: {
  file: ExplorerFile;
  onEdit?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const type = file.mimeType.toLowerCase();
  const textual = isTextEditable(file);
  useEffect(() => {
    if (!textual) return;
    call<{ content: string }>(`/api/cloud/files/${file.id}?text=1`)
      .then((result) => setText(result.content))
      .catch(() => setText(""));
  }, [file.id, textual]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="cloud-preview-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="cloud-preview-dialog" role="dialog" aria-modal="true" aria-label={`Vorschau: ${file.name}`}>
        <header>
          <div>
            <p className="eyebrow">{file.path}</p>
            <h2>{file.name}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Vorschau schliessen">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="cloud-preview-content">
          {type.startsWith("image/") && type !== "image/svg+xml" ? (
            <Image src={fileUrl(file.id, true)} alt={file.name} width={1400} height={1000} unoptimized />
          ) : type.startsWith("video/") ? (
            <video src={fileUrl(file.id, true)} controls playsInline />
          ) : type.startsWith("audio/") ? (
            <audio src={fileUrl(file.id, true)} controls />
          ) : type === "application/pdf" ? (
            <iframe src={fileUrl(file.id, true)} title={file.name} />
          ) : textual ? (
            <pre className="files-preview-text">{text ?? "Wird geladen …"}</pre>
          ) : (
            <div className="cloud-empty">Für diese Datei gibt es keine Vorschau. Bitte herunterladen.</div>
          )}
        </div>
        <footer>
          <span>
            {fileKind(file)} · {prettyBytes(file.sizeBytes)} · Version {file.versionNo}
          </span>
          <span className="files-preview-actions">
            {onEdit && (
              <button className="secondary-button" type="button" onClick={onEdit}>
                Bearbeiten
              </button>
            )}
            <button className="secondary-button" type="button" onClick={() => download(fileUrl(file.id))}>
              <DownloadSimple aria-hidden="true" />
              Herunterladen
            </button>
          </span>
        </footer>
      </section>
    </div>
  );
}
