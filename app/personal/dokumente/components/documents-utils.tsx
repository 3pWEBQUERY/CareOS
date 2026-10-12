"use client";

import { type ModuleIconName } from "@/app/components/module-icon";
import { DOCUMENT_STATUS, PREVIEW_TYPES, type LibraryDocument } from "@/lib/documents-shared";

export type Folder = {
  id: string;
  label: string;
  detail: string;
  icon: ModuleIconName;
  match: (d: LibraryDocument) => boolean;
};

export const current = (d: LibraryDocument) => d.status === "active" || d.status === "draft";

export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function statusOf(d: LibraryDocument, today: string) {
  if (d.status !== "active") return DOCUMENT_STATUS[d.status];
  if (d.kind === "standard") {
    if (d.reviewDueOn && d.reviewDueOn < today) return { label: "Prüfung fällig", tone: "critical" };
    if (d.requiresAck && !d.acknowledgedAt) return { label: "Bestätigen", tone: "attention" };
    if (!d.readAt) return { label: "Neu", tone: "info" };
    return { label: "Verbindlich", tone: "stable" };
  }
  return DOCUMENT_STATUS.active;
}

export function fileIcon(d: LibraryDocument): ModuleIconName {
  if (d.kind === "standard") return d.category === "Hygiene" ? "check" : d.category === "Weisung" ? "docs" : "quality";
  if (d.category === "Notfall") return "alert";
  if (d.category === "Formulare" || d.category === "Vorlagen") return "note";
  return "docs";
}

export const fileUrl = (d: LibraryDocument) =>
  d.fileId
    ? `/api/cloud/files/${d.fileId}${d.mimeType && PREVIEW_TYPES.includes(d.mimeType) ? "?preview=1" : ""}`
    : null;

export async function postForm(url: string, form: FormData) {
  const response = await fetch(url, { method: "POST", body: form });
  const data = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
  if (!response.ok) throw new Error(data.error || "Speichern fehlgeschlagen.");
  return data;
}

export type Dialog = { kind: "upload" } | { kind: "version" | "edit" | "archive"; doc: LibraryDocument };
