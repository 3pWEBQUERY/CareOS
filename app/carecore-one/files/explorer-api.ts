"use client";

import type { ExplorerFile, FileScope, FolderNode } from "@/lib/files-shared";

// Anfragen der Ablage; Fehlertexte kommen vom Server (deutsch, verständlich).
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function call<T = Record<string, unknown>>(url: string, init?: RequestInit & { json?: unknown }) {
  const response = await fetch(url, {
    ...init,
    headers: init?.json === undefined ? init?.headers : { "content-type": "application/json", ...init?.headers },
    body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok)
    throw new RequestError(String(payload.error ?? "Das hat nicht geklappt."), response.status, payload);
  return payload as T;
}

export type UploadOutcome =
  { kind: "done"; file: ExplorerFile } | { kind: "conflict"; existing: { id: string; name: string } };

export async function uploadOne(
  file: File,
  scope: FileScope,
  folderId: string | null,
  conflict?: "replace" | "keep",
): Promise<UploadOutcome> {
  const form = new FormData();
  form.append("file", file);
  form.append("scope", scope);
  if (folderId) form.append("folderId", folderId);
  if (conflict) form.append("conflict", conflict);
  try {
    const result = await call<{ file: ExplorerFile }>("/api/cloud/files", { method: "POST", body: form });
    return { kind: "done", file: result.file };
  } catch (error) {
    if (error instanceof RequestError && error.status === 409 && error.payload.conflict)
      return { kind: "conflict", existing: error.payload.conflict as { id: string; name: string } };
    throw error;
  }
}

export const loadTree = (scope: FileScope) =>
  call<{ folders: FolderNode[] }>(`/api/cloud/folders?scope=${scope}`).then((result) => result.folders);

export const fileUrl = (id: string, preview = false) => `/api/cloud/files/${id}${preview ? "?preview=1" : ""}`;

export function zipUrl(scope: FileScope, fileIds: string[], folderIds: string[]) {
  const params = new URLSearchParams({ scope });
  if (fileIds.length) params.set("files", fileIds.join(","));
  if (folderIds.length) params.set("folders", folderIds.join(","));
  return `/api/cloud/zip?${params}`;
}

// Download ohne Seitenwechsel (Datei oder ZIP).
export function download(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}
