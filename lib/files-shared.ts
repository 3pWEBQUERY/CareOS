// Ablage (Kommunikation): Typen und Regeln für Server und Oberfläche.

export type FileScope = "personal" | "shared";
export type ExplorerView = "folder" | "search" | "recent" | "trash";

export type Crumb = { id: string | null; name: string };

export type ExplorerFolder = {
  id: string;
  name: string;
  parentId: string | null;
  itemCount: number;
  createdByName: string | null;
  updatedAt: string;
  canEdit: boolean;
  deletedAt: string | null;
  path: string;
};

export type ExplorerFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string | null;
  uploadedByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  versionNo: number;
  canEdit: boolean;
  deletedAt: string | null;
  path: string;
};

export type ExplorerListing = {
  scope: FileScope;
  view: ExplorerView;
  folder: Crumb | null;
  path: Crumb[];
  folders: ExplorerFolder[];
  files: ExplorerFile[];
  canManage: boolean;
  canCreate: boolean;
  totalFiles: number;
  totalBytes: number;
};

export type FolderNode = { id: string; name: string; parentId: string | null };

export type FileVersion = {
  id: string;
  versionNo: number;
  name: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
  current: boolean;
};

export const FILE_MAX_BYTES = 4 * 1024 * 1024;
export const TEXT_EDIT_MAX_BYTES = 512 * 1024;
export const TRASH_DAYS = 30;

// Einfache Dateien direkt in der Ablage: reiner Text, Notiz (Markdown) und Liste (CSV). Dokumente, Tabellen und
// Präsentationen im Office-Format: lib/office/model.ts.
export const NEW_DOCUMENTS = {
  text: { label: "Einfacher Text", extension: "txt", mimeType: "text/plain" },
  note: { label: "Notiz", extension: "md", mimeType: "text/markdown" },
  list: { label: "Liste (CSV)", extension: "csv", mimeType: "text/csv" },
} as const;
export type NewDocumentKind = keyof typeof NEW_DOCUMENTS;

const TEXT_EXTENSIONS = ["txt", "md", "csv", "log"];

export const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

// Textdateien lassen sich direkt in der Ablage bearbeiten.
export function isTextEditable(file: { name: string; mimeType: string; sizeBytes: number }) {
  const type = file.mimeType.split(";")[0].trim().toLowerCase();
  const text = type.startsWith("text/") || TEXT_EXTENSIONS.includes(extensionOf(file.name));
  return text && file.sizeBytes <= TEXT_EDIT_MAX_BYTES;
}

// Art der Datei für Symbol und Spalte „Typ“.
export function fileKind(file: { name: string; mimeType: string }) {
  const type = file.mimeType.toLowerCase();
  const extension = extensionOf(file.name);
  if (type.startsWith("image/")) return "Bild";
  if (type.startsWith("video/")) return "Video";
  if (type.startsWith("audio/")) return "Audio";
  if (type === "application/pdf" || extension === "pdf") return "PDF";
  if (["doc", "docx", "odt", "rtf"].includes(extension)) return "Word";
  if (["xls", "xlsx", "ods"].includes(extension)) return "Excel";
  if (["ppt", "pptx", "odp"].includes(extension)) return "PowerPoint";
  if (extension === "csv") return "Liste";
  if (extension === "md") return "Notiz";
  if (["zip", "7z", "rar"].includes(extension)) return "Archiv";
  if (type.startsWith("text/") || extension === "txt") return "Text";
  return extension ? extension.toUpperCase() : "Datei";
}

// Name ohne Konflikt im Ordner: „Plan.pdf“ → „Plan (2).pdf“.
export function nextFreeName(name: string, taken: string[]) {
  const lower = new Set(taken.map((item) => item.toLocaleLowerCase("de-CH")));
  if (!lower.has(name.toLocaleLowerCase("de-CH"))) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 2; ; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    if (!lower.has(candidate.toLocaleLowerCase("de-CH"))) return candidate;
  }
}

export function prettyBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${String(Math.round((bytes / 1024 / 1024) * 10) / 10).replace(".", ",")} MB`;
}
