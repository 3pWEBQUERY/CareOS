import type { OfficePlace } from "@/lib/office/presence";
import { mediaContent, removeMedia, storeMedia } from "@/lib/storage";
import { randomUUID } from "node:crypto";
import { ApiError, iso, type Row } from "@/lib/api-context";
import { carecoreDb, hasPermission, type CarecoreActor } from "@/lib/server-data";
import { auditOrigin } from "@/lib/audit-origin";
import {
  FILE_MAX_BYTES,
  NEW_DOCUMENTS,
  TEXT_EDIT_MAX_BYTES,
  TRASH_DAYS,
  extensionOf,
  isTextEditable,
  nextFreeName,
  type Crumb,
  type ExplorerFile,
  type ExplorerFolder,
  type ExplorerListing,
  type ExplorerView,
  type FileScope,
  type FileVersion,
  type FolderNode,
  type NewDocumentKind,
} from "@/lib/files-shared";
import { createZip, uniquePath, type ZipEntry } from "@/lib/zip";
import { buildDocx, readDocx } from "@/lib/office/docx";
import { buildPptx, readPptx } from "@/lib/office/pptx";
import { buildXlsx, readXlsx } from "@/lib/office/xlsx";
import { stampModelComments } from "@/lib/office/comments";
import {
  OFFICE_TEMPLATES,
  OFFICE_TYPES,
  cleanModel,
  officeKindOf,
  templateModel,
  type DeckModel,
  type DocumentModel,
  type OfficeKind,
  type OfficeModel,
  type SheetModel,
} from "@/lib/office/model";

// Ablage von Kommunikation, aufgebaut wie der Dateibereich eines Teams:
// - „Meine Dateien“ (purpose 'cloud', nur für die Person) und „Gemeinsame Ablage“ (purpose 'shared', ganzes Haus)
// - Ordner in Ordnern (carecore_shared_folders; owner_user_id gesetzt = persönlicher Ordner)
// - Papierkorb: Löschen verschiebt Dateien und Ordner samt Inhalt; nach 30 Tagen werden sie endgültig entfernt
// - Versionen: neue Fassung hochladen oder Text bearbeiten legt die bisherige Fassung als Version ab
// Rechte in der gemeinsamen Ablage: alle Mitarbeitenden sehen alles, laden hoch und legen Ordner an; ändern,
// verschieben und löschen dürfen die Person, die das Element angelegt hat, sowie Team- und Administrationsleitung.

export type { FileScope } from "@/lib/files-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZIP_MAX_FILES = 300;
const ZIP_MAX_BYTES = 80 * 1024 * 1024;

export const managesSharedFiles = (actor: CarecoreActor) =>
  hasPermission(actor, "administration.manage") || hasPermission(actor, "team.manage");

function org(actor: CarecoreActor) {
  if (!actor.organizationId) throw new ApiError("Keine Organisation zugeordnet.", 400);
  return actor.organizationId;
}

const scopeOf = (value: unknown): FileScope => (value === "shared" ? "shared" : "personal");

const cleanName = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .trim()
        .replace(/[\\/\u0000-\u001f]/g, "-")
        .slice(0, max)
    : "";

const folderIdOf = (value: unknown) => {
  if (value === null || value === undefined || value === "" || value === "root") return null;
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError("Ordner ist ungültig.");
  return value;
};

type FolderRow = {
  id: string;
  name: string;
  parentId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
};

type FileRow = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  versionNo: number;
  deletedAt: string | null;
  deletedBy: string | null;
};

// Alles einer Ablage (ohne Inhalte): Ordner und Dateien der Person bzw. des Hauses.
async function loadScope(actor: CarecoreActor, scope: FileScope) {
  const sql = carecoreDb();
  const organizationId = org(actor);
  const [folderRows, fileRows] = await Promise.all([
    scope === "shared"
      ? sql`
          SELECT sf.id, sf.name, sf.parent_id, sf.created_by, sf.updated_at, sf.deleted_at, sf.deleted_by,
            u.display_name AS created_by_name
          FROM carecore_shared_folders sf LEFT JOIN carecore_users u ON u.id = sf.created_by
          WHERE sf.organization_id = ${organizationId} AND sf.owner_user_id IS NULL`
      : sql`
          SELECT sf.id, sf.name, sf.parent_id, sf.created_by, sf.updated_at, sf.deleted_at, sf.deleted_by,
            NULL AS created_by_name
          FROM carecore_shared_folders sf
          WHERE sf.organization_id = ${organizationId} AND sf.owner_user_id = ${actor.id}`,
    sql`
      SELECT f.id, f.name, f.mime_type, f.size_bytes, f.folder_id, f.uploaded_by, f.created_at, f.updated_at,
        f.version_no, f.deleted_at, f.deleted_by, up.display_name AS uploaded_by_name, ed.display_name AS updated_by_name
      FROM carecore_cloud_files f
      LEFT JOIN carecore_users up ON up.id = f.uploaded_by
      LEFT JOIN carecore_users ed ON ed.id = f.updated_by
      WHERE f.organization_id = ${organizationId}
        AND ${scope === "shared" ? sql`f.purpose = 'shared'` : sql`f.purpose = 'cloud' AND f.uploaded_by = ${actor.id}`}`,
  ]);
  const folders: FolderRow[] = (folderRows as Row[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    parentId: row.parent_id ? String(row.parent_id) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    updatedAt: iso(row.updated_at) ?? "",
    deletedAt: iso(row.deleted_at),
    deletedBy: row.deleted_by ? String(row.deleted_by) : null,
  }));
  const files: FileRow[] = (fileRows as Row[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    mimeType: String(row.mime_type ?? ""),
    sizeBytes: Number(row.size_bytes),
    folderId: row.folder_id ? String(row.folder_id) : null,
    uploadedBy: row.uploaded_by ? String(row.uploaded_by) : null,
    uploadedByName: row.uploaded_by_name ? String(row.uploaded_by_name) : null,
    updatedByName: row.updated_by_name ? String(row.updated_by_name) : null,
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
    versionNo: Number(row.version_no ?? 1),
    deletedAt: iso(row.deleted_at),
    deletedBy: row.deleted_by ? String(row.deleted_by) : null,
  }));
  return new ScopeIndex(actor, scope, folders, files);
}

class ScopeIndex {
  readonly byId: Map<string, FolderRow>;
  constructor(
    readonly actor: CarecoreActor,
    readonly scope: FileScope,
    readonly folders: FolderRow[],
    readonly files: FileRow[],
  ) {
    this.byId = new Map(folders.map((folder) => [folder.id, folder]));
  }
  get manager() {
    return this.scope === "shared" && managesSharedFiles(this.actor);
  }
  // Ordner samt aller übergeordneten Ordner nicht im Papierkorb.
  alive(folderId: string | null): boolean {
    for (let id = folderId, guard = 0; id && guard < 64; guard += 1) {
      const folder = this.byId.get(id);
      if (!folder || folder.deletedAt) return false;
      id = folder.parentId;
    }
    return true;
  }
  chain(folderId: string | null): FolderRow[] {
    const chain: FolderRow[] = [];
    for (let id = folderId, guard = 0; id && guard < 64; guard += 1) {
      const folder = this.byId.get(id);
      if (!folder) break;
      chain.unshift(folder);
      id = folder.parentId;
    }
    return chain;
  }
  pathOf(folderId: string | null) {
    return [this.rootName, ...this.chain(folderId).map((folder) => folder.name)].join(" / ");
  }
  get rootName() {
    return this.scope === "shared" ? "Gemeinsame Ablage" : "Meine Dateien";
  }
  descendants(folderId: string): string[] {
    const result = [folderId];
    for (let index = 0; index < result.length; index += 1)
      for (const folder of this.folders) if (folder.parentId === result[index]) result.push(folder.id);
    return result;
  }
  canEditFile(file: FileRow) {
    return file.uploadedBy === this.actor.id || this.manager;
  }
  canEditFolder(folder: FolderRow) {
    return this.scope === "personal" || folder.createdBy === this.actor.id || this.manager;
  }
  folder(id: string, options: { alive?: boolean } = {}) {
    const folder = this.byId.get(id);
    if (!folder || (options.alive !== false && !this.alive(id))) throw new ApiError("Ordner nicht gefunden.", 404);
    return folder;
  }
  file(id: string) {
    const file = this.files.find((item) => item.id === id);
    if (!file) throw new ApiError("Datei nicht gefunden.", 404);
    return file;
  }
  siblingsNames(folderId: string | null, excludeId?: string) {
    return [
      ...this.files.filter((file) => file.folderId === folderId && !file.deletedAt && file.id !== excludeId),
      ...this.folders.filter((folder) => folder.parentId === folderId && !folder.deletedAt && folder.id !== excludeId),
    ].map((item) => item.name);
  }
  toFolder(folder: FolderRow): ExplorerFolder {
    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      itemCount:
        this.folders.filter((item) => item.parentId === folder.id && !item.deletedAt).length +
        this.files.filter((item) => item.folderId === folder.id && !item.deletedAt).length,
      createdByName: folder.createdByName,
      updatedAt: folder.updatedAt,
      canEdit: this.canEditFolder(folder),
      deletedAt: folder.deletedAt,
      path: this.pathOf(folder.parentId),
    };
  }
  toFile(file: FileRow): ExplorerFile {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      folderId: file.folderId,
      uploadedByName: file.uploadedByName,
      updatedByName: file.updatedByName ?? file.uploadedByName,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      versionNo: file.versionNo,
      canEdit: this.canEditFile(file),
      deletedAt: file.deletedAt,
      path: this.pathOf(file.folderId),
    };
  }
}

async function audit(
  actor: CarecoreActor,
  scope: FileScope,
  entity: string,
  id: string,
  action: string,
  data: unknown,
) {
  // Persönliche Dateien gehen niemanden etwas an; protokolliert wird die gemeinsame Ablage.
  if (scope !== "shared") return;
  const origin = auditOrigin(actor);
  await carecoreDb()`
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
    VALUES (${randomUUID()}, ${org(actor)}, ${actor.id}, ${origin.sessionId}, ${origin.userAgent}, ${entity}, ${id}, ${action}, ${JSON.stringify(data)}::jsonb)`;
}

// Papierkorb leeren, was älter als 30 Tage ist (bei jedem Öffnen der Ablage; je Organisation).
async function purgeExpired(actor: CarecoreActor) {
  const sql = carecoreDb();
  const organizationId = org(actor);
  const expired = (await sql`
    SELECT f.id FROM carecore_cloud_files f
    WHERE f.organization_id = ${organizationId} AND f.purpose IN ('cloud', 'shared')
      AND (f.deleted_at < NOW() - make_interval(days => ${TRASH_DAYS})
        OR f.folder_id IN (SELECT id FROM carecore_shared_folders
          WHERE organization_id = ${organizationId} AND deleted_at < NOW() - make_interval(days => ${TRASH_DAYS})))`) as Row[];
  const ids = expired.map((row) => String(row.id));
  const keys: unknown[] = [];
  if (ids.length) {
    const versions = (await sql`
      SELECT storage_key FROM carecore_cloud_file_versions WHERE file_id = ANY(${ids}::uuid[])`) as Row[];
    const removed = (await sql`
      DELETE FROM carecore_cloud_files WHERE id = ANY(${ids}::uuid[]) RETURNING storage_key`) as Row[];
    keys.push(...versions.map((row) => row.storage_key), ...removed.map((row) => row.storage_key));
  }
  await sql`
    DELETE FROM carecore_shared_folders
    WHERE organization_id = ${organizationId} AND deleted_at < NOW() - make_interval(days => ${TRASH_DAYS})`;
  await removeMedia(keys);
}

export async function listing(
  actor: CarecoreActor,
  scopeInput: unknown,
  options: { folderId?: unknown; view?: unknown; query?: unknown },
): Promise<ExplorerListing> {
  const scope = scopeOf(scopeInput);
  await purgeExpired(actor);
  const index = await loadScope(actor, scope);
  const view: ExplorerView = ["search", "recent", "trash"].includes(String(options.view))
    ? (String(options.view) as ExplorerView)
    : "folder";
  const aliveFiles = index.files.filter((file) => !file.deletedAt && index.alive(file.folderId));
  const base = {
    scope,
    view,
    canManage: index.manager,
    canCreate: true,
    totalFiles: aliveFiles.length,
    totalBytes: aliveFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
  };
  const byName = <T extends { name: string }>(items: T[]) =>
    [...items].sort((a, b) => a.name.localeCompare(b.name, "de-CH", { numeric: true }));

  if (view === "search") {
    const query = String(options.query ?? "")
      .trim()
      .toLocaleLowerCase("de-CH");
    const match = (name: string) => query.length > 0 && name.toLocaleLowerCase("de-CH").includes(query);
    return {
      ...base,
      folder: null,
      path: [],
      folders: byName(index.folders.filter((folder) => index.alive(folder.id) && match(folder.name))).map((folder) =>
        index.toFolder(folder),
      ),
      files: byName(aliveFiles.filter((file) => match(file.name))).map((file) => index.toFile(file)),
    };
  }
  if (view === "recent") {
    return {
      ...base,
      folder: null,
      path: [],
      folders: [],
      files: [...aliveFiles]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 40)
        .map((file) => index.toFile(file)),
    };
  }
  if (view === "trash") {
    const visible = (createdBy: string | null, deletedBy: string | null) =>
      index.scope === "personal" || index.manager || createdBy === actor.id || deletedBy === actor.id;
    return {
      ...base,
      folder: null,
      path: [],
      folders: index.folders
        .filter(
          (folder) =>
            folder.deletedAt &&
            !(folder.parentId && index.byId.get(folder.parentId)?.deletedAt) &&
            visible(folder.createdBy, folder.deletedBy),
        )
        .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
        .map((folder) => index.toFolder(folder)),
      files: index.files
        .filter(
          (file) =>
            file.deletedAt &&
            !(file.folderId && index.byId.get(file.folderId)?.deletedAt) &&
            visible(file.uploadedBy, file.deletedBy),
        )
        .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
        .map((file) => index.toFile(file)),
    };
  }
  const folderId = folderIdOf(options.folderId);
  const current = folderId ? index.folder(folderId) : null;
  const path: Crumb[] = [
    { id: null, name: index.rootName },
    ...index.chain(folderId).map((folder) => ({ id: folder.id, name: folder.name })),
  ];
  return {
    ...base,
    folder: current ? { id: current.id, name: current.name } : { id: null, name: index.rootName },
    path,
    folders: byName(index.folders.filter((folder) => folder.parentId === folderId && !folder.deletedAt)).map((folder) =>
      index.toFolder(folder),
    ),
    files: byName(aliveFiles.filter((file) => file.folderId === folderId)).map((file) => index.toFile(file)),
  };
}

// Ordnerbaum für „Verschieben“ und „Kopieren“ (nur Ordner ausserhalb des Papierkorbs).
export async function folderTree(actor: CarecoreActor, scopeInput: unknown): Promise<FolderNode[]> {
  const index = await loadScope(actor, scopeOf(scopeInput));
  return index.folders
    .filter((folder) => index.alive(folder.id))
    .map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId }))
    .sort((a, b) => a.name.localeCompare(b.name, "de-CH", { numeric: true }));
}

// Datei für eine Aktion laden: in welcher Ablage sie liegt, entscheidet die Datei selbst.
async function locateFile(actor: CarecoreActor, fileId: string) {
  if (!UUID.test(fileId)) throw new ApiError("Datei nicht gefunden.", 404);
  const rows = (await carecoreDb()`
    SELECT purpose, uploaded_by FROM carecore_cloud_files
    WHERE id = ${fileId} AND organization_id = ${org(actor)} AND purpose IN ('cloud', 'shared')`) as Row[];
  const row = rows[0];
  // Nicht vorhanden und nicht erlaubt sehen gleich aus, damit sich Kennungen nicht ausprobieren lassen.
  if (!row || (row.purpose === "cloud" && row.uploaded_by !== actor.id))
    throw new ApiError("Datei nicht gefunden.", 404);
  const scope: FileScope = row.purpose === "shared" ? "shared" : "personal";
  const index = await loadScope(actor, scope);
  return { index, file: index.file(fileId), scope };
}

async function locateFolder(actor: CarecoreActor, folderId: string) {
  if (!UUID.test(folderId)) throw new ApiError("Ordner nicht gefunden.", 404);
  const rows = (await carecoreDb()`
    SELECT owner_user_id FROM carecore_shared_folders WHERE id = ${folderId} AND organization_id = ${org(actor)}`) as Row[];
  const row = rows[0];
  if (!row || (row.owner_user_id && row.owner_user_id !== actor.id)) throw new ApiError("Ordner nicht gefunden.", 404);
  const scope: FileScope = row.owner_user_id ? "personal" : "shared";
  const index = await loadScope(actor, scope);
  return { index, folder: index.folder(folderId, { alive: false }), scope };
}

function assertEditFile(index: ScopeIndex, file: FileRow) {
  if (!index.canEditFile(file))
    throw new ApiError("Ändern dürfen die Person, die die Datei hochgeladen hat, und die Leitung.", 403);
}

function assertEditFolder(index: ScopeIndex, folder: FolderRow) {
  if (!index.canEditFolder(folder))
    throw new ApiError("Ändern dürfen die Person, die den Ordner angelegt hat, und die Leitung.", 403);
}

async function storeContent(actor: CarecoreActor, key: string, bytes: Buffer, type: string) {
  const storageKey = await storeMedia("files", org(actor), key, bytes, type);
  return { storageKey, base64: storageKey ? null : bytes.toString("base64") };
}

// Bisherige Fassung als Version ablegen und neuen Inhalt speichern (gleiche Datei, Version + 1).
// Automatisches Speichern derselben Person innerhalb von zehn Minuten („coalesce“) ersetzt den Inhalt ohne neue
// Version – sonst entstünde bei jedem Tastendruck-Stopp eine Version. Der Zähler „revision“ steigt bei jeder
// Speicherung und schützt vor dem Überschreiben fremder Änderungen.
const COALESCE_MINUTES = 10;

async function writeVersion(
  actor: CarecoreActor,
  fileId: string,
  bytes: Buffer,
  type: string,
  check: { versionNo?: number; revision?: number; coalesce?: boolean } = {},
) {
  const sql = carecoreDb();
  const rows = (await sql`
    SELECT version_no, revision, updated_by, storage_key,
      updated_at > NOW() - make_interval(mins => ${COALESCE_MINUTES}) AS recent
    FROM carecore_cloud_files WHERE id = ${fileId}`) as Row[];
  const current = rows[0];
  if (!current) throw new ApiError("Datei nicht gefunden.", 404);
  const version = Number(current.version_no);
  const revision = Number(current.revision ?? 0);
  const conflict = () =>
    new ApiError(
      "Die Datei wurde inzwischen von jemand anderem geändert. Bitte neu öffnen und die Änderung erneut vornehmen.",
      409,
    );
  if (check.versionNo !== undefined && check.versionNo !== version) throw conflict();
  if (check.revision !== undefined && check.revision !== revision) throw conflict();
  if (check.coalesce && current.updated_by === actor.id && current.recent === true) {
    const content = await storeContent(actor, `${fileId}.v${version}.r${revision + 1}`, bytes, type);
    const changed = (await sql`
      UPDATE carecore_cloud_files SET content_base64 = ${content.base64}, storage_key = ${content.storageKey},
        size_bytes = ${bytes.length}, mime_type = ${type}, revision = ${revision + 1}, updated_at = NOW()
      WHERE id = ${fileId} AND revision = ${revision}
      RETURNING id`) as Row[];
    if (!changed[0]) {
      await removeMedia([content.storageKey]);
      throw conflict();
    }
    // Die ersetzte Fassung ist keine Version: ihren Speicher freigeben, sofern nichts anderes darauf zeigt.
    if (current.storage_key && current.storage_key !== content.storageKey) {
      const used = (await sql`
        SELECT 1 FROM carecore_cloud_file_versions WHERE storage_key = ${current.storage_key}
        UNION ALL SELECT 1 FROM carecore_cloud_files WHERE storage_key = ${current.storage_key} LIMIT 1`) as Row[];
      if (!used[0]) await removeMedia([current.storage_key]);
    }
    return { versionNo: version, revision: revision + 1, archived: false };
  }
  const next = version + 1;
  const content = await storeContent(actor, `${fileId}.v${next}`, bytes, type);
  // Nur wenn die Datei noch die erwartete Fassung hat (gleichzeitiges Speichern verliert sonst nichts unbemerkt).
  const changed = (await sql.transaction([
    sql`
      INSERT INTO carecore_cloud_file_versions (id, file_id, version_no, name, mime_type, size_bytes, content_base64, storage_key, uploaded_by, created_at)
      SELECT ${randomUUID()}, id, version_no, name, mime_type, size_bytes, content_base64, storage_key,
        COALESCE(updated_by, uploaded_by), updated_at
      FROM carecore_cloud_files WHERE id = ${fileId} AND version_no = ${version} AND revision = ${revision}`,
    sql`
      UPDATE carecore_cloud_files SET content_base64 = ${content.base64}, storage_key = ${content.storageKey},
        size_bytes = ${bytes.length}, mime_type = ${type}, version_no = ${next}, revision = ${revision + 1},
        updated_by = ${actor.id}, updated_at = NOW()
      WHERE id = ${fileId} AND version_no = ${version} AND revision = ${revision}
      RETURNING id`,
  ])) as Row[][];
  if (!changed[1]?.[0]) {
    await removeMedia([content.storageKey]);
    throw new ApiError("Die Datei wurde gleichzeitig geändert. Bitte erneut versuchen.", 409);
  }
  return { versionNo: next, revision: revision + 1, archived: true };
}

export type UploadResult = { file: ExplorerFile } | { conflict: { id: string; name: string } };

// Hochladen in einen Ordner. Gibt es den Namen dort schon: ohne Angabe Rückfrage (409), „replace“ legt eine neue
// Version der bestehenden Datei an, „keep“ behält beide („Plan (2).pdf“).
export async function uploadFile(actor: CarecoreActor, form: FormData): Promise<UploadResult> {
  const scope = scopeOf(form.get("scope"));
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError("Bitte wähle eine Datei aus.");
  if (file.size > FILE_MAX_BYTES) throw new ApiError("Dateien dürfen höchstens 4 MB gross sein.", 413);
  let name = cleanName(file.name, 220);
  if (!name) throw new ApiError("Der Dateiname ist ungültig.");
  const index = await loadScope(actor, scope);
  const folderId = folderIdOf(form.get("folderId"));
  if (folderId) index.folder(folderId);
  const type = file.type || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());
  const existing = index.files.find(
    (item) =>
      item.folderId === folderId &&
      !item.deletedAt &&
      item.name.toLocaleLowerCase("de-CH") === name.toLocaleLowerCase("de-CH"),
  );
  const mode = form.get("conflict");
  if (existing && mode !== "replace" && mode !== "keep") return { conflict: { id: existing.id, name: existing.name } };
  if (existing && mode === "replace") {
    assertEditFile(index, existing);
    const { versionNo: version } = await writeVersion(actor, existing.id, bytes, type);
    await audit(actor, scope, "shared_file", existing.id, "versioned", { name, version });
    const reloaded = await loadScope(actor, scope);
    return { file: reloaded.toFile(reloaded.file(existing.id)) };
  }
  if (existing) name = nextFreeName(name, index.siblingsNames(folderId));
  const id = randomUUID();
  const content = await storeContent(actor, id, bytes, type);
  await carecoreDb()`
    INSERT INTO carecore_cloud_files (id, organization_id, name, mime_type, size_bytes, content_base64, storage_key, uploaded_by, updated_by, purpose, folder_id)
    VALUES (${id}, ${org(actor)}, ${name}, ${type}, ${file.size}, ${content.base64}, ${content.storageKey},
      ${actor.id}, ${actor.id}, ${scope === "shared" ? "shared" : "cloud"}, ${folderId})`;
  await audit(actor, scope, "shared_file", id, "uploaded", { name, folder: index.pathOf(folderId) });
  const reloaded = await loadScope(actor, scope);
  return { file: reloaded.toFile(reloaded.file(id)) };
}

// Neues Dokument direkt in der Ablage: Word-Dokument, Excel-Tabelle oder PowerPoint-Präsentation aus einer Vorlage
// ({ template }), als Kopie eines geöffneten Dokuments ({ office, model }) oder eine einfache Textdatei, Notiz oder
// Liste ({ kind }). Danach öffnet es sich im Editor.
export async function createDocument(actor: CarecoreActor, body: Record<string, unknown>) {
  const scope = scopeOf(body.scope);
  const template = OFFICE_TEMPLATES.find((item) => item.id === body.template);
  const office = body.office === "document" || body.office === "sheet" || body.office === "deck" ? body.office : null;
  const kind = (String(body.kind) in NEW_DOCUMENTS ? String(body.kind) : "text") as NewDocumentKind;
  const spec = template ? OFFICE_TYPES[template.kind] : office ? OFFICE_TYPES[office] : NEW_DOCUMENTS[kind];
  const index = await loadScope(actor, scope);
  const folderId = folderIdOf(body.folderId);
  if (folderId) index.folder(folderId);
  const given = cleanName(body.name, 200);
  let name = given || (template ? template.name : spec.label);
  if (office && !body.model) throw new ApiError("Inhalt fehlt.");
  if (extensionOf(name) !== spec.extension) name = `${name}.${spec.extension}`;
  const taken = index.siblingsNames(folderId);
  // Ohne eigenen Namen wie in Office: „Protokoll Teamsitzung (2).docx“; ein gewählter Name muss frei sein.
  if (!given || office) name = nextFreeName(name, taken);
  else if (taken.some((item) => item.toLocaleLowerCase("de-CH") === name.toLocaleLowerCase("de-CH")))
    throw new ApiError("Eine Datei mit diesem Namen gibt es hier bereits.", 409);
  const id = randomUUID();
  const bytes = template
    ? buildOffice(templateModel(template.id), name, String(actor.display_name ?? ""))
    : office
      ? buildOffice(cleanModel(office, body.model), name, String(actor.display_name ?? ""))
      : Buffer.from(typeof body.content === "string" ? body.content.slice(0, TEXT_EDIT_MAX_BYTES) : "", "utf8");
  if (bytes.length > FILE_MAX_BYTES)
    throw new ApiError("Die Datei würde grösser als 4 MB. Bitte Bilder verkleinern oder entfernen.", 413);
  const content = await storeContent(actor, id, bytes, spec.mimeType);
  await carecoreDb()`
    INSERT INTO carecore_cloud_files (id, organization_id, name, mime_type, size_bytes, content_base64, storage_key, uploaded_by, updated_by, purpose, folder_id)
    VALUES (${id}, ${org(actor)}, ${name}, ${spec.mimeType}, ${bytes.length}, ${content.base64}, ${content.storageKey},
      ${actor.id}, ${actor.id}, ${scope === "shared" ? "shared" : "cloud"}, ${folderId})`;
  await audit(actor, scope, "shared_file", id, "uploaded", { name, folder: index.pathOf(folderId) });
  const reloaded = await loadScope(actor, scope);
  return reloaded.toFile(reloaded.file(id));
}

function buildOffice(model: OfficeModel, name: string, author: string) {
  const meta = { title: name.replace(/\.[^.]+$/, ""), author };
  if (model.kind === "document") return buildDocx(model, meta);
  if (model.kind === "sheet") return buildXlsx(model, meta);
  return buildPptx(model, meta);
}

// Dokument, Tabelle oder Präsentation zum Bearbeiten öffnen (auch Dateien aus Word, Excel oder PowerPoint).
export async function readOffice(actor: CarecoreActor, fileId: string) {
  const { index, file } = await locateFile(actor, fileId);
  if (file.deletedAt) throw new ApiError("Die Datei liegt im Papierkorb.", 409);
  const kind = officeKindOf(file.name);
  if (!kind) throw new ApiError("Diese Datei lässt sich nicht als Dokument, Tabelle oder Präsentation öffnen.");
  const rows = (await carecoreDb()`
    SELECT content_base64, storage_key, revision FROM carecore_cloud_files WHERE id = ${fileId}`) as Row[];
  const bytes = await mediaContent(rows[0]?.storage_key, rows[0]?.content_base64);
  if (!bytes) throw new ApiError("Der Inhalt der Datei ist nicht verfügbar.", 404);
  let read: { model: OfficeModel; imported: boolean };
  try {
    read = kind === "document" ? readDocx(bytes) : kind === "sheet" ? readXlsx(bytes) : readPptx(bytes);
  } catch {
    throw new ApiError("Die Datei ist beschädigt oder kein gültiges Office-Dokument und lässt sich nicht öffnen.", 422);
  }
  return {
    file: index.toFile(file),
    kind,
    model: read.model,
    imported: read.imported,
    revision: Number(rows[0]?.revision ?? 0),
    canEdit: index.canEditFile(file),
    // Name für neue Kommentare (der Server setzt ihn beim Speichern ohnehin selbst).
    user: authorName(actor),
  };
}

const authorName = (actor: CarecoreActor) => String(actor.display_name || actor.username || "").slice(0, 120);

// Bisheriger Stand der Datei als Modell (für den Abgleich der Kommentare), null wenn er nicht lesbar ist.
async function storedModel(fileId: string, kind: OfficeKind): Promise<OfficeModel | null> {
  const rows = (await carecoreDb()`
    SELECT content_base64, storage_key FROM carecore_cloud_files WHERE id = ${fileId}`) as Row[];
  const bytes = await mediaContent(rows[0]?.storage_key, rows[0]?.content_base64);
  if (!bytes) return null;
  try {
    return (kind === "document" ? readDocx(bytes) : kind === "sheet" ? readXlsx(bytes) : readPptx(bytes)).model;
  } catch {
    return null;
  }
}

// Speichern aus dem Editor: schreibt eine echte .docx/.xlsx/.pptx-Datei. Automatisches Speichern („auto“) fasst
// Änderungen derselben Person zusammen; „Speichern“ von Hand legt immer eine Version an.
export async function saveOffice(actor: CarecoreActor, fileId: string, body: Record<string, unknown>) {
  const { index, file, scope } = await locateFile(actor, fileId);
  assertEditFile(index, file);
  if (file.deletedAt) throw new ApiError("Die Datei liegt im Papierkorb.", 409);
  const kind = officeKindOf(file.name);
  if (!kind) throw new ApiError("Diese Datei ist kein Dokument, keine Tabelle und keine Präsentation.");
  const revision = Number(body.revision);
  if (!Number.isInteger(revision)) throw new ApiError("Stand der Datei fehlt. Bitte neu öffnen.");
  // Kommentare: Name und Zeit neuer Einträge vom Server, fremde Einträge bleiben unverändert.
  const model = stampModelComments(
    await storedModel(fileId, kind),
    cleanModel(kind, body.model),
    authorName(actor),
    new Date().toISOString(),
  );
  const bytes =
    kind === "document"
      ? buildDocx(model as DocumentModel, {
          title: file.name.replace(/\.[^.]+$/, ""),
          author: String(actor.display_name ?? ""),
        })
      : kind === "sheet"
        ? buildXlsx(model as SheetModel, {
            title: file.name.replace(/\.[^.]+$/, ""),
            author: String(actor.display_name ?? ""),
          })
        : buildPptx(model as DeckModel, {
            title: file.name.replace(/\.[^.]+$/, ""),
            author: String(actor.display_name ?? ""),
          });
  if (bytes.length > FILE_MAX_BYTES)
    throw new ApiError("Die Datei würde grösser als 4 MB. Bitte Bilder verkleinern oder entfernen.", 413);
  const result = await writeVersion(actor, fileId, bytes, OFFICE_TYPES[kind].mimeType, {
    revision,
    coalesce: body.auto === true,
  });
  if (result.archived)
    await audit(actor, scope, "shared_file", fileId, "versioned", { name: file.name, version: result.versionNo });
  const reloaded = await loadScope(actor, scope);
  return { file: reloaded.toFile(reloaded.file(fileId)), revision: result.revision };
}

// Gleichzeitiges Bearbeiten: Lebenszeichen des Editors (wer ist wo in der Datei) und neuester Stand. Das Modell
// kommt nur mit, wenn sich die Datei seit dem Stand des Editors geändert hat.
const PRESENCE_SECONDS = 30;
const SESSION = /^[A-Za-z0-9_-]{8,40}$/;

function cleanPlace(input: unknown): OfficePlace | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const place: OfficePlace = {};
  if (typeof raw.sheet === "string" && SESSION.test(raw.sheet)) place.sheet = raw.sheet;
  if (typeof raw.cell === "string" && /^[A-Z]{1,3}[1-9]\d{0,6}$/.test(raw.cell)) place.cell = raw.cell;
  if (typeof raw.slide === "string" && SESSION.test(raw.slide)) place.slide = raw.slide;
  if (Number.isInteger(raw.block) && Number(raw.block) >= 0 && Number(raw.block) < 100_000)
    place.block = Number(raw.block);
  return Object.keys(place).length ? place : null;
}

// Leichte Zugriffsprüfung für das gleichzeitige Bearbeiten (läuft sekündlich): dieselben Regeln wie locateFile –
// gemeinsame Ablage für die ganze Einrichtung, persönliche Ablage nur für die eigene Person –, ohne die ganze
// Ablage zu laden.
async function liveFile(actor: CarecoreActor, fileId: string) {
  if (!UUID.test(fileId)) throw new ApiError("Datei nicht gefunden.", 404);
  const rows = (await carecoreDb()`
    SELECT name, purpose, uploaded_by, deleted_at FROM carecore_cloud_files
    WHERE id = ${fileId} AND organization_id = ${org(actor)} AND purpose IN ('cloud', 'shared')`) as Row[];
  const row = rows[0];
  if (!row || (row.purpose === "cloud" && row.uploaded_by !== actor.id))
    throw new ApiError("Datei nicht gefunden.", 404);
  if (row.deleted_at) throw new ApiError("Die Datei liegt im Papierkorb.", 409);
  const kind = officeKindOf(String(row.name));
  if (!kind) throw new ApiError("Diese Datei ist kein Dokument, keine Tabelle und keine Präsentation.");
  return kind;
}

// Stand der Datei und die anderen Personen darin (eine Abfrage).
async function liveState(actor: CarecoreActor, fileId: string, session: string) {
  const rows = (await carecoreDb()`
    SELECT f.revision, f.deleted_at,
      COALESCE((
        SELECT json_agg(json_build_object('session', p.session_id, 'user', p.user_id, 'name', p.display_name,
          'place', p.place) ORDER BY p.display_name, p.session_id)
        FROM carecore_office_presence p
        WHERE p.file_id = f.id AND p.session_id <> ${session}
          AND p.seen_at > NOW() - make_interval(secs => ${PRESENCE_SECONDS})
      ), '[]'::json) AS people
    FROM carecore_cloud_files f WHERE f.id = ${fileId}`) as Row[];
  const row = rows[0];
  if (!row || row.deleted_at) throw new ApiError("Die Datei liegt im Papierkorb.", 409);
  const people = (typeof row.people === "string" ? JSON.parse(row.people) : row.people) as Row[];
  return {
    revision: Number(row.revision ?? 0),
    people: people.map((person) => ({
      session: String(person.session),
      name: String(person.name),
      self: person.user === actor.id,
      place: cleanPlace(person.place),
    })),
  };
}

// Lebenszeichen: eigene Stelle melden, andere Personen und – wenn sich die Datei seit dem Stand des Editors
// geändert hat – den neuesten Stand holen.
export async function officeLive(actor: CarecoreActor, fileId: string, body: Record<string, unknown>) {
  const kind = await liveFile(actor, fileId);
  const session = String(body.session ?? "");
  if (!SESSION.test(session)) throw new ApiError("Sitzung fehlt. Bitte neu öffnen.");
  const sql = carecoreDb();
  if (body.leave === true) {
    await sql`DELETE FROM carecore_office_presence WHERE file_id = ${fileId} AND session_id = ${session}`;
    return { revision: Number(body.revision) || 0, people: [] };
  }
  const place = cleanPlace(body.place);
  await sql`
    INSERT INTO carecore_office_presence (file_id, session_id, user_id, display_name, place, seen_at)
    VALUES (${fileId}, ${session}, ${actor.id}, ${authorName(actor) || "Unbekannt"}, ${place ? JSON.stringify(place) : null}::jsonb, NOW())
    ON CONFLICT (file_id, session_id) DO UPDATE
      SET place = EXCLUDED.place, seen_at = NOW(), display_name = EXCLUDED.display_name`;
  await sql`
    DELETE FROM carecore_office_presence
    WHERE file_id = ${fileId} AND seen_at < NOW() - make_interval(secs => ${PRESENCE_SECONDS * 4})`;
  const result = await liveState(actor, fileId, session);
  if (Number(body.revision) === result.revision) return result;
  const rows = (await sql`
    SELECT content_base64, storage_key, revision FROM carecore_cloud_files WHERE id = ${fileId}`) as Row[];
  const bytes = await mediaContent(rows[0]?.storage_key, rows[0]?.content_base64);
  if (!bytes) return result;
  try {
    const read = kind === "document" ? readDocx(bytes) : kind === "sheet" ? readXlsx(bytes) : readPptx(bytes);
    // Stand passend zum mitgeschickten Inhalt (zwischen den Abfragen kann gespeichert worden sein).
    return { ...result, revision: Number(rows[0]?.revision ?? result.revision), model: read.model };
  } catch {
    return result;
  }
}

// Für die laufende Verbindung des Editors (Server-Sent Events): einmal prüfen, dann nur noch den Stand abfragen.
export async function officeLiveStream(actor: CarecoreActor, fileId: string, session: string) {
  await liveFile(actor, fileId);
  if (!SESSION.test(session)) throw new ApiError("Sitzung fehlt. Bitte neu öffnen.");
  return () => liveState(actor, fileId, session);
}

// Text zum Bearbeiten (UTF-8) mit aktueller Version für die Kontrolle beim Speichern.
export async function readText(actor: CarecoreActor, fileId: string) {
  const { index, file } = await locateFile(actor, fileId);
  if (file.deletedAt) throw new ApiError("Die Datei liegt im Papierkorb.", 409);
  if (!isTextEditable(file)) throw new ApiError("Diese Datei lässt sich nicht als Text bearbeiten.");
  const rows = (await carecoreDb()`
    SELECT content_base64, storage_key FROM carecore_cloud_files WHERE id = ${fileId}`) as Row[];
  const content = await mediaContent(rows[0]?.storage_key, rows[0]?.content_base64);
  return {
    file: index.toFile(file),
    content: content ? content.toString("utf8") : "",
    canEdit: index.canEditFile(file),
  };
}

export async function saveText(actor: CarecoreActor, fileId: string, body: Record<string, unknown>) {
  const { index, file, scope } = await locateFile(actor, fileId);
  assertEditFile(index, file);
  if (file.deletedAt) throw new ApiError("Die Datei liegt im Papierkorb.", 409);
  if (!isTextEditable(file)) throw new ApiError("Diese Datei lässt sich nicht als Text bearbeiten.");
  if (typeof body.content !== "string") throw new ApiError("Inhalt fehlt.");
  const bytes = Buffer.from(body.content, "utf8");
  if (bytes.length > TEXT_EDIT_MAX_BYTES) throw new ApiError("Der Text ist zu lang (höchstens 512 KB).", 413);
  const { versionNo: version } = await writeVersion(actor, fileId, bytes, file.mimeType || "text/plain", {
    versionNo: Number(body.versionNo),
  });
  await audit(actor, scope, "shared_file", fileId, "versioned", { name: file.name, version });
  const reloaded = await loadScope(actor, scope);
  return reloaded.toFile(reloaded.file(fileId));
}

// Umbenennen, verschieben (auch in die gemeinsame Ablage: „share“) oder in den Papierkorb und zurück.
export async function updateFile(actor: CarecoreActor, fileId: string, body: Record<string, unknown>) {
  const { index, file, scope } = await locateFile(actor, fileId);
  assertEditFile(index, file);
  const sql = carecoreDb();
  if (body.action === "trash") {
    await sql`UPDATE carecore_cloud_files SET deleted_at = NOW(), deleted_by = ${actor.id} WHERE id = ${fileId} AND deleted_at IS NULL`;
    await audit(actor, scope, "shared_file", fileId, "deleted", { name: file.name });
    return null;
  }
  if (body.action === "restore") {
    if (!file.deletedAt) return index.toFile(file);
    const folderId = index.alive(file.folderId) ? file.folderId : null;
    const name = nextFreeName(file.name, index.siblingsNames(folderId, file.id));
    await sql`UPDATE carecore_cloud_files SET deleted_at = NULL, deleted_by = NULL, folder_id = ${folderId}, name = ${name}
      WHERE id = ${fileId}`;
    await audit(actor, scope, "shared_file", fileId, "restored", { name, folder: index.pathOf(folderId) });
    const reloaded = await loadScope(actor, scope);
    return reloaded.toFile(reloaded.file(fileId));
  }
  if (file.deletedAt) throw new ApiError("Die Datei liegt im Papierkorb. Bitte zuerst wiederherstellen.", 409);
  if (body.share === true && scope === "personal") {
    const shared = await loadScope(actor, "shared");
    const target = folderIdOf(body.folderId);
    if (target) shared.folder(target);
    const name = nextFreeName(file.name, shared.siblingsNames(target));
    await sql`UPDATE carecore_cloud_files SET purpose = 'shared', folder_id = ${target}, name = ${name},
      updated_by = ${actor.id}, updated_at = NOW() WHERE id = ${fileId}`;
    await audit(actor, "shared", "shared_file", fileId, "shared", { name, folder: shared.pathOf(target) });
    const reloaded = await loadScope(actor, "shared");
    return reloaded.toFile(reloaded.file(fileId));
  }
  const folderId = body.folderId === undefined ? file.folderId : folderIdOf(body.folderId);
  if (folderId) index.folder(folderId);
  let name = body.name === undefined ? file.name : cleanName(body.name, 220);
  if (!name) throw new ApiError("Bitte gib einen gültigen Dateinamen an.");
  const taken = index.siblingsNames(folderId, file.id);
  if (taken.some((item) => item.toLocaleLowerCase("de-CH") === name.toLocaleLowerCase("de-CH"))) {
    // Beim Umbenennen bewusst nachfragen, beim Verschieben einen freien Namen wählen.
    if (body.name !== undefined && folderId === file.folderId)
      throw new ApiError("Eine Datei oder ein Ordner mit diesem Namen gibt es hier bereits.", 409);
    name = nextFreeName(name, taken);
  }
  await sql`UPDATE carecore_cloud_files SET name = ${name}, folder_id = ${folderId}, updated_by = ${actor.id}, updated_at = NOW()
    WHERE id = ${fileId}`;
  await audit(actor, scope, "shared_file", fileId, folderId === file.folderId ? "updated" : "moved", {
    name,
    folder: index.pathOf(folderId),
  });
  const reloaded = await loadScope(actor, scope);
  return reloaded.toFile(reloaded.file(fileId));
}

// Kopie in einen Ordner derselben Ablage (z. B. Vorlage für einen neuen Monat).
export async function copyFile(actor: CarecoreActor, fileId: string, body: Record<string, unknown>) {
  const { index, file, scope } = await locateFile(actor, fileId);
  if (file.deletedAt) throw new ApiError("Die Datei liegt im Papierkorb.", 409);
  const folderId = folderIdOf(body.folderId);
  if (folderId) index.folder(folderId);
  const rows = (await carecoreDb()`
    SELECT content_base64, storage_key FROM carecore_cloud_files WHERE id = ${fileId}`) as Row[];
  const bytes = await mediaContent(rows[0]?.storage_key, rows[0]?.content_base64);
  if (!bytes) throw new ApiError("Der Inhalt der Datei ist nicht verfügbar.", 404);
  const name = nextFreeName(file.name, index.siblingsNames(folderId));
  const id = randomUUID();
  const content = await storeContent(actor, id, bytes, file.mimeType);
  await carecoreDb()`
    INSERT INTO carecore_cloud_files (id, organization_id, name, mime_type, size_bytes, content_base64, storage_key, uploaded_by, updated_by, purpose, folder_id)
    VALUES (${id}, ${org(actor)}, ${name}, ${file.mimeType}, ${bytes.length}, ${content.base64}, ${content.storageKey},
      ${actor.id}, ${actor.id}, ${scope === "shared" ? "shared" : "cloud"}, ${folderId})`;
  await audit(actor, scope, "shared_file", id, "copied", { name, from: file.name, folder: index.pathOf(folderId) });
  const reloaded = await loadScope(actor, scope);
  return reloaded.toFile(reloaded.file(id));
}

// Endgültig löschen (nur aus dem Papierkorb): persönlich die Person, gemeinsam die Leitung oder wer hochgeladen hat.
export async function purgeFile(actor: CarecoreActor, fileId: string) {
  const { index, file, scope } = await locateFile(actor, fileId);
  assertEditFile(index, file);
  if (!file.deletedAt) throw new ApiError("Endgültig löschen lässt sich nur aus dem Papierkorb.", 409);
  const sql = carecoreDb();
  const versions = (await sql`SELECT storage_key FROM carecore_cloud_file_versions WHERE file_id = ${fileId}`) as Row[];
  const removed = (await sql`DELETE FROM carecore_cloud_files WHERE id = ${fileId} RETURNING storage_key`) as Row[];
  await removeMedia([...removed, ...versions].map((row) => row.storage_key));
  await audit(actor, scope, "shared_file", fileId, "purged", { name: file.name });
}

export async function listVersions(actor: CarecoreActor, fileId: string): Promise<FileVersion[]> {
  const { index, file } = await locateFile(actor, fileId);
  const rows = (await carecoreDb()`
    SELECT v.id, v.version_no, v.name, v.size_bytes, v.created_at, u.display_name
    FROM carecore_cloud_file_versions v LEFT JOIN carecore_users u ON u.id = v.uploaded_by
    WHERE v.file_id = ${fileId} ORDER BY v.version_no DESC`) as Row[];
  return [
    {
      id: "current",
      versionNo: file.versionNo,
      name: file.name,
      sizeBytes: file.sizeBytes,
      uploadedByName: index.toFile(file).updatedByName,
      createdAt: file.updatedAt,
      current: true,
    },
    ...rows.map((row) => ({
      id: String(row.id),
      versionNo: Number(row.version_no),
      name: String(row.name),
      sizeBytes: Number(row.size_bytes),
      uploadedByName: row.display_name ? String(row.display_name) : null,
      createdAt: iso(row.created_at) ?? "",
      current: false,
    })),
  ];
}

// Inhalt einer früheren Version (zum Herunterladen).
export async function versionContent(actor: CarecoreActor, fileId: string, versionId: string) {
  await locateFile(actor, fileId);
  if (!UUID.test(versionId)) throw new ApiError("Version nicht gefunden.", 404);
  const rows = (await carecoreDb()`
    SELECT version_no, name, mime_type, content_base64, storage_key FROM carecore_cloud_file_versions
    WHERE id = ${versionId} AND file_id = ${fileId}`) as Row[];
  const row = rows[0];
  const content = row ? await mediaContent(row.storage_key, row.content_base64) : null;
  if (!row || !content) throw new ApiError("Version nicht gefunden.", 404);
  const name = String(row.name);
  const dot = name.lastIndexOf(".");
  const label =
    dot > 0
      ? `${name.slice(0, dot)} (Version ${row.version_no})${name.slice(dot)}`
      : `${name} (Version ${row.version_no})`;
  return { name: label, content };
}

// Frühere Version wiederherstellen: wird zur neuen aktuellen Version (die bisherige bleibt als Version erhalten).
export async function restoreVersion(actor: CarecoreActor, fileId: string, versionId: string) {
  const { index, file, scope } = await locateFile(actor, fileId);
  assertEditFile(index, file);
  if (file.deletedAt) throw new ApiError("Die Datei liegt im Papierkorb.", 409);
  if (!UUID.test(versionId)) throw new ApiError("Version nicht gefunden.", 404);
  const rows = (await carecoreDb()`
    SELECT version_no, mime_type, content_base64, storage_key FROM carecore_cloud_file_versions
    WHERE id = ${versionId} AND file_id = ${fileId}`) as Row[];
  const content = rows[0] ? await mediaContent(rows[0].storage_key, rows[0].content_base64) : null;
  if (!rows[0] || !content) throw new ApiError("Version nicht gefunden.", 404);
  const { versionNo: version } = await writeVersion(actor, fileId, content, String(rows[0].mime_type));
  await audit(actor, scope, "shared_file", fileId, "version_restored", {
    name: file.name,
    from: Number(rows[0].version_no),
    version,
  });
  const reloaded = await loadScope(actor, scope);
  return reloaded.toFile(reloaded.file(fileId));
}

export async function createFolder(actor: CarecoreActor, body: Record<string, unknown>) {
  const scope = scopeOf(body.scope);
  const index = await loadScope(actor, scope);
  const parentId = folderIdOf(body.parentId);
  if (parentId) index.folder(parentId);
  const name = cleanName(body.name, 120);
  if (!name) throw new ApiError("Bitte einen Ordnernamen angeben.");
  if (index.siblingsNames(parentId).some((item) => item.toLocaleLowerCase("de-CH") === name.toLocaleLowerCase("de-CH")))
    throw new ApiError("Einen Ordner oder eine Datei mit diesem Namen gibt es hier bereits.", 409);
  const id = randomUUID();
  await carecoreDb()`
    INSERT INTO carecore_shared_folders (id, organization_id, name, parent_id, owner_user_id, created_by)
    VALUES (${id}, ${org(actor)}, ${name}, ${parentId}, ${scope === "personal" ? actor.id : null}, ${actor.id})`;
  await audit(actor, scope, "shared_folder", id, "created", { name, folder: index.pathOf(parentId) });
  return id;
}

export async function updateFolder(actor: CarecoreActor, folderId: string, body: Record<string, unknown>) {
  const { index, folder, scope } = await locateFolder(actor, folderId);
  assertEditFolder(index, folder);
  const sql = carecoreDb();
  if (body.action === "trash") {
    if (folder.deletedAt) return;
    const subtree = index.descendants(folderId).filter((id) => !index.byId.get(id)?.deletedAt);
    // Inhalt mit demselben Zeitpunkt markieren: beim Wiederherstellen kommt genau das zurück.
    await sql.transaction([
      sql`UPDATE carecore_shared_folders SET deleted_at = NOW(), deleted_by = ${actor.id}
        WHERE id = ANY(${subtree}::uuid[]) AND deleted_at IS NULL`,
      sql`UPDATE carecore_cloud_files SET deleted_at = NOW(), deleted_by = ${actor.id}
        WHERE folder_id = ANY(${subtree}::uuid[]) AND deleted_at IS NULL`,
    ]);
    await audit(actor, scope, "shared_folder", folderId, "deleted", { name: folder.name });
    return;
  }
  if (body.action === "restore") {
    if (!folder.deletedAt) return;
    const subtree = index.descendants(folderId);
    const parentId = folder.parentId && index.alive(folder.parentId) ? folder.parentId : null;
    const name = nextFreeName(folder.name, index.siblingsNames(parentId, folderId));
    // Gleicher Löschzeitpunkt wie der Ordner (exakt aus der Datenbank, nicht gerundet): genau dieser Inhalt kehrt zurück.
    const stamp = sql`(SELECT deleted_at FROM carecore_shared_folders WHERE id = ${folderId})`;
    await sql.transaction([
      sql`UPDATE carecore_cloud_files SET deleted_at = NULL, deleted_by = NULL
        WHERE folder_id = ANY(${subtree}::uuid[]) AND deleted_at = ${stamp}`,
      sql`UPDATE carecore_shared_folders SET deleted_at = NULL, deleted_by = NULL
        WHERE id = ANY(${subtree}::uuid[]) AND id <> ${folderId} AND deleted_at = ${stamp}`,
      sql`UPDATE carecore_shared_folders SET deleted_at = NULL, deleted_by = NULL, parent_id = ${parentId}, name = ${name},
        updated_at = NOW() WHERE id = ${folderId}`,
    ]);
    await audit(actor, scope, "shared_folder", folderId, "restored", { name, folder: index.pathOf(parentId) });
    return;
  }
  if (folder.deletedAt) throw new ApiError("Der Ordner liegt im Papierkorb. Bitte zuerst wiederherstellen.", 409);
  const parentId = body.parentId === undefined ? folder.parentId : folderIdOf(body.parentId);
  if (parentId) {
    index.folder(parentId);
    if (index.descendants(folderId).includes(parentId))
      throw new ApiError("Ein Ordner lässt sich nicht in sich selbst verschieben.");
  }
  const name = body.name === undefined ? folder.name : cleanName(body.name, 120);
  if (!name) throw new ApiError("Bitte einen Ordnernamen angeben.");
  if (
    index
      .siblingsNames(parentId, folderId)
      .some((item) => item.toLocaleLowerCase("de-CH") === name.toLocaleLowerCase("de-CH"))
  )
    throw new ApiError("Einen Ordner oder eine Datei mit diesem Namen gibt es dort bereits.", 409);
  await sql`UPDATE carecore_shared_folders SET name = ${name}, parent_id = ${parentId}, updated_at = NOW() WHERE id = ${folderId}`;
  await audit(actor, scope, "shared_folder", folderId, parentId === folder.parentId ? "renamed" : "moved", {
    name,
    folder: index.pathOf(parentId),
  });
}

// Ordner endgültig löschen (aus dem Papierkorb), samt Inhalt und Versionen.
export async function purgeFolder(actor: CarecoreActor, folderId: string) {
  const { index, folder, scope } = await locateFolder(actor, folderId);
  assertEditFolder(index, folder);
  if (!folder.deletedAt) throw new ApiError("Endgültig löschen lässt sich nur aus dem Papierkorb.", 409);
  const subtree = index.descendants(folderId);
  const sql = carecoreDb();
  const versions = (await sql`
    SELECT v.storage_key FROM carecore_cloud_file_versions v JOIN carecore_cloud_files f ON f.id = v.file_id
    WHERE f.folder_id = ANY(${subtree}::uuid[])`) as Row[];
  const removed = (await sql`
    DELETE FROM carecore_cloud_files WHERE folder_id = ANY(${subtree}::uuid[]) RETURNING storage_key`) as Row[];
  await sql`DELETE FROM carecore_shared_folders WHERE id = ${folderId}`;
  await removeMedia([...removed, ...versions].map((row) => row.storage_key));
  await audit(actor, scope, "shared_folder", folderId, "purged", { name: folder.name });
}

// Mehrere Dateien bzw. ganze Ordner als ZIP (Ordnerstruktur bleibt erhalten).
export async function zipSelection(actor: CarecoreActor, scopeInput: unknown, fileIds: string[], folderIds: string[]) {
  const scope = scopeOf(scopeInput);
  const index = await loadScope(actor, scope);
  const picked: Array<{ file: FileRow; path: string }> = [];
  for (const id of fileIds) {
    const file = index.file(id);
    if (!file.deletedAt) picked.push({ file, path: file.name });
  }
  for (const id of folderIds) {
    const folder = index.folder(id);
    const base = index.chain(folder.parentId).length;
    for (const sub of index.descendants(id))
      for (const file of index.files.filter((item) => item.folderId === sub && !item.deletedAt))
        picked.push({
          file,
          path: [
            ...index
              .chain(sub)
              .slice(base)
              .map((item) => item.name),
            file.name,
          ].join("/"),
        });
  }
  if (!picked.length) throw new ApiError("Keine Dateien ausgewählt.");
  if (picked.length > ZIP_MAX_FILES || picked.reduce((sum, item) => sum + item.file.sizeBytes, 0) > ZIP_MAX_BYTES)
    throw new ApiError("Die Auswahl ist zu gross für einen Download auf einmal. Bitte weniger Dateien wählen.", 413);
  const rows = (await carecoreDb()`
    SELECT id, content_base64, storage_key FROM carecore_cloud_files
    WHERE id = ANY(${picked.map((item) => item.file.id)}::uuid[])`) as Row[];
  const contents = new Map(rows.map((row) => [String(row.id), row]));
  const taken = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const item of picked) {
    const row = contents.get(item.file.id);
    const content = row ? await mediaContent(row.storage_key, row.content_base64) : null;
    if (content) entries.push({ path: uniquePath(item.path, taken), content, modified: new Date(item.file.updatedAt) });
  }
  const name =
    folderIds.length === 1 && !fileIds.length ? index.folder(folderIds[0]).name : `${index.rootName} – Auswahl`;
  return { name: `${name}.zip`, content: createZip(entries) };
}

// Gemeinsame Ablage für den Messenger: Datei darf geteilt werden, wenn sie in der Ablage der Person liegt.
export async function shareableFile(actor: CarecoreActor, fileId: string) {
  const { file, scope } = await locateFile(actor, fileId);
  if (file.deletedAt) throw new ApiError("Die Datei liegt im Papierkorb.", 409);
  return { id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, scope };
}
