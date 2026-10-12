// Document library and standards definitions shared by the API and the client workspace.

export type DocumentKind = "document" | "standard";

export const DOCUMENT_CATEGORIES: Record<DocumentKind, readonly string[]> = {
  document: ["Formulare", "Vorlagen", "Checklisten", "Notfall", "Organisation", "Sonstiges"],
  standard: ["Pflegestandard", "Hygiene", "Weisung", "Organisation", "Qualität"],
};

export const DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
] as const;

// Types the browser can show directly; others are downloaded.
export const PREVIEW_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"];

export const DOCUMENT_STATUS = {
  draft: { label: "Entwurf", tone: "attention" },
  active: { label: "Aktuell", tone: "stable" },
  superseded: { label: "Ersetzt", tone: "archived" },
  archived: { label: "Archiviert", tone: "archived" },
} as const;
export type DocumentStatus = keyof typeof DOCUMENT_STATUS;

export type LibraryDocument = {
  id: string;
  kind: DocumentKind;
  title: string;
  description: string | null;
  category: string;
  status: DocumentStatus;
  versionNo: number;
  previousId: string | null;
  changeNote: string | null;
  fileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedById: string | null;
  uploadedByName: string | null;
  createdAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  reviewDueOn: string | null;
  requiresAck: boolean;
  readAt: string | null;
  acknowledgedAt: string | null;
  readCount: number;
  ackCount: number;
  archiveReason: string | null;
  canEdit: boolean;
};

export type DocumentsPayload = {
  kind: DocumentKind;
  today: string;
  documents: LibraryDocument[];
  audience: number;
  canUpload: boolean;
  canManage: boolean;
  currentUserId: string;
};

export function fileTypeLabel(mime: string | null) {
  if (!mime) return "Ohne Datei";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Bild";
  if (mime === "text/plain") return "Text";
  if (mime.includes("word") || mime.includes("opendocument.text")) return "Word";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "Excel";
  if (mime.includes("powerpoint") || mime.includes("presentation")) return "PowerPoint";
  return "Datei";
}

export function fileSizeLabel(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${String(Math.round((bytes / 1024 / 1024) * 10) / 10).replace(".", ",")} MB`;
}
