import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, iso, num, text, type ApiContext, type Row } from "@/lib/api-context";
import { storeFile } from "@/lib/files";
import { hasPermission } from "@/lib/server-data";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TYPES,
  type DocumentKind,
  type DocumentsPayload,
  type LibraryDocument,
} from "@/lib/documents-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Standards are published by quality management; the library is maintained by leadership and staff.
const canManage = (ctx: ApiContext, kind: DocumentKind) =>
  hasPermission(ctx.actor, "quality.manage") || (kind === "document" && hasPermission(ctx.actor, "team.manage"));
const canUpload = (ctx: ApiContext, kind: DocumentKind) =>
  kind === "standard" ? canManage(ctx, kind) : hasPermission(ctx.actor, "documentation.write");

function parseKind(value: unknown): DocumentKind {
  return value === "standard" ? "standard" : "document";
}

async function orgToday({ sql, actor }: ApiContext) {
  const rows = (await sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today FROM carecore_organizations WHERE id = ${actor.organizationId}`) as Row[];
  return String(rows[0].today);
}

async function selectDocuments(ctx: ApiContext, where: { kind?: DocumentKind; id?: string }) {
  const { sql, actor } = ctx;
  const rows = (await sql`
    SELECT d.*, to_char(d.review_due_on, 'YYYY-MM-DD') AS review_text, f.name AS file_name,
      u.display_name AS uploaded_name, a.display_name AS approved_name, r.read_at, r.acknowledged_at,
      (SELECT COUNT(*) FROM carecore_document_reads x WHERE x.document_id = d.id)::int AS read_count,
      (SELECT COUNT(*) FROM carecore_document_reads x WHERE x.document_id = d.id AND x.acknowledged_at IS NOT NULL)::int AS ack_count
    FROM carecore_documents d
    LEFT JOIN carecore_cloud_files f ON f.id = d.file_id
    LEFT JOIN carecore_users u ON u.id = d.uploaded_by
    LEFT JOIN carecore_users a ON a.id = d.approved_by
    LEFT JOIN carecore_document_reads r ON r.document_id = d.id AND r.user_id = ${actor.id}
    WHERE d.organization_id = ${actor.organizationId} AND d.resident_id IS NULL
      AND (${where.kind ?? null}::text IS NULL OR d.kind = ${where.kind ?? null})
      AND (${where.id ?? null}::uuid IS NULL OR d.id = ${where.id ?? null}::uuid)
      -- Drafts are only visible to people who may edit them.
      AND (d.status <> 'draft' OR d.uploaded_by = ${actor.id} OR ${hasPermission(actor, "quality.manage")}
        OR (d.kind = 'document' AND ${hasPermission(actor, "team.manage")}))
    ORDER BY d.status = 'active' DESC, d.updated_at DESC
    LIMIT 1000`) as Row[];
  return rows.map((row): LibraryDocument => {
    const kind = parseKind(row.kind);
    return {
      id: String(row.id),
      kind,
      title: String(row.title),
      description: (row.description as string | null) ?? null,
      category: String(row.category ?? "Sonstiges"),
      status: row.status as LibraryDocument["status"],
      versionNo: Number(row.version_no),
      previousId: (row.previous_id as string | null) ?? null,
      changeNote: (row.change_note as string | null) ?? null,
      fileId: (row.file_id as string | null) ?? null,
      fileName: (row.file_name as string | null) ?? null,
      mimeType: (row.mime_type as string | null) ?? null,
      sizeBytes: num(row.size_bytes),
      uploadedById: (row.uploaded_by as string | null) ?? null,
      uploadedByName: (row.uploaded_name as string | null) ?? null,
      createdAt: iso(row.created_at) ?? "",
      approvedByName: (row.approved_name as string | null) ?? null,
      approvedAt: iso(row.approved_at),
      reviewDueOn: (row.review_text as string | null) ?? null,
      requiresAck: Boolean(row.requires_ack),
      readAt: iso(row.read_at),
      acknowledgedAt: iso(row.acknowledged_at),
      readCount: Number(row.read_count),
      ackCount: Number(row.ack_count),
      archiveReason: (row.archive_reason as string | null) ?? null,
      canEdit: canManage(ctx, kind) || (kind === "document" && row.uploaded_by === ctx.actor.id),
    };
  });
}

export async function listDocuments(ctx: ApiContext, params: URLSearchParams): Promise<DocumentsPayload> {
  const kind = parseKind(params.get("kind"));
  const [documents, today, audience] = await Promise.all([
    selectDocuments(ctx, { kind }),
    orgToday(ctx),
    ctx.sql`
      SELECT COUNT(*)::int AS n FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
      WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active` as Promise<Row[]>,
  ]);
  return {
    kind,
    today,
    documents,
    audience: Number(audience[0]?.n ?? 0),
    canUpload: canUpload(ctx, kind),
    canManage: canManage(ctx, kind),
    currentUserId: ctx.actor.id,
  };
}

function parseMeta(kind: DocumentKind, input: { get: (key: string) => unknown }) {
  const title = text(input.get("title"), 220);
  if (title.length < 3) throw new ApiError("Bitte einen Titel mit mindestens 3 Zeichen angeben.");
  const category = String(input.get("category") ?? "");
  if (!DOCUMENT_CATEGORIES[kind].includes(category)) throw new ApiError("Bitte eine Kategorie wählen.");
  const review = input.get("reviewDueOn");
  const reviewDueOn = typeof review === "string" && DATE.test(review) ? review : null;
  return {
    title,
    category,
    description: text(input.get("description"), 2000) || null,
    reviewDueOn: kind === "standard" ? reviewDueOn : null,
    requiresAck: kind === "standard" && (input.get("requiresAck") === "true" || input.get("requiresAck") === true),
  };
}

// Neue Fassung = neue Zeile: frühere Bestätigungen gelten nicht weiter, alle werden erneut um Bestätigung gebeten.
function notifyStandard(ctx: ApiContext, id: string, title: string, versionNo: number, ackRequested = false) {
  const heading = ackRequested ? "Bestätigung nötig" : versionNo > 1 ? "Standard aktualisiert" : "Neuer Standard";
  return ctx.sql`
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
    SELECT gen_random_uuid(), u.id, ${`${heading}: ${title}`},
      'Bitte lesen und mit „Gelesen & verstanden“ bestätigen.', 'standard', 'high', ${`/c/personal/dokumente/standards?document=${id}`}
    FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active AND u.id <> ${ctx.actor.id}
      AND NOT EXISTS (SELECT 1 FROM carecore_document_reads r WHERE r.document_id = ${id} AND r.user_id = u.id
        AND r.acknowledged_at IS NOT NULL)`;
}

export async function createDocument(ctx: ApiContext, form: FormData) {
  const kind = parseKind(form.get("kind"));
  if (!canUpload(ctx, kind))
    throw new ApiError(
      kind === "standard" ? "Standards veröffentlicht das Qualitätsmanagement." : "Keine Berechtigung zum Hochladen.",
      403,
    );
  const meta = parseMeta(kind, form);
  const file = await storeFile(ctx, form.get("file"), "document", DOCUMENT_TYPES);
  const publish = form.get("status") !== "draft";
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_documents (id, organization_id, kind, title, category, description, file_id, storage_key, mime_type,
        size_bytes, version, version_no, status, requires_ack, review_due_on, uploaded_by, approved_by, approved_at)
      VALUES (${id}, ${ctx.actor.organizationId}, ${kind}, ${meta.title}, ${meta.category}, ${meta.description}, ${file.id},
        ${`cloud:${file.id}`}, ${file.type}, ${file.size}, '1', 1, ${publish ? "active" : "draft"}, ${meta.requiresAck},
        ${meta.reviewDueOn}, ${ctx.actor.id}, ${publish && kind === "standard" ? ctx.actor.id : null},
        ${publish && kind === "standard" ? new Date().toISOString() : null})`,
    ctx.sql`INSERT INTO carecore_document_reads (document_id, user_id, acknowledged_at) VALUES (${id}, ${ctx.actor.id}, NOW())`,
    auditStatement(ctx, kind, id, publish ? "published" : "drafted", null, { ...meta, file: file.name }),
    ...(publish && kind === "standard" && meta.requiresAck ? [notifyStandard(ctx, id, meta.title, 1)] : []),
  ]);
  return id;
}

async function loadDocument(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Dokument");
  const doc = (await selectDocuments(ctx, { id }))[0];
  if (!doc) throw new ApiError("Dokument nicht gefunden.", 404);
  return doc;
}

// A new version replaces the current one; the old version stays available as "superseded".
export async function newVersion(ctx: ApiContext, idInput: unknown, form: FormData) {
  const doc = await loadDocument(ctx, idInput);
  if (!doc.canEdit) throw new ApiError("Keine Berechtigung für neue Versionen.", 403);
  if (doc.status !== "active" && doc.status !== "draft")
    throw new ApiError("Nur aktuelle Dokumente erhalten neue Versionen.", 409);
  const note = text(form.get("changeNote"), 1000);
  if (!note) throw new ApiError("Bitte kurz beschreiben, was sich geändert hat.");
  // Je Dokument höchstens eine Folgeversion (Entwurf oder aktuell), sonst gäbe es zwei gültige Fassungen.
  const successor = (await ctx.sql`
    SELECT 1 FROM carecore_documents WHERE previous_id = ${doc.id} AND status IN ('draft', 'active') LIMIT 1`) as Row[];
  if (successor[0]) throw new ApiError("Zu diesem Dokument gibt es bereits eine neue Version (Entwurf).", 409);
  const file = await storeFile(ctx, form.get("file"), "document", DOCUMENT_TYPES);
  const publish = form.get("status") !== "draft";
  const id = randomUUID();
  const versionNo = doc.versionNo + 1;
  // Die Prüfung auf eine Folgeversion wiederholt die Einfügung selbst, damit zwei gleichzeitige Uploads nicht beide
  // gelingen; ohne eingefügte Zeile scheitert die Lesebestätigung (Fremdschlüssel) und damit die ganze Transaktion.
  try {
    await ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_documents (id, organization_id, kind, title, category, description, file_id, storage_key, mime_type,
          size_bytes, version, version_no, previous_id, change_note, status, requires_ack, review_due_on, uploaded_by,
          approved_by, approved_at)
        SELECT ${id}, organization_id, kind, title, category, description, ${file.id}, ${`cloud:${file.id}`}, ${file.type},
          ${file.size}, ${String(versionNo)}, ${versionNo}, ${doc.id}, ${note}, ${publish ? "active" : "draft"}, requires_ack,
          review_due_on, ${ctx.actor.id}, ${publish && doc.kind === "standard" ? ctx.actor.id : null},
          ${publish && doc.kind === "standard" ? new Date().toISOString() : null}
        FROM carecore_documents d WHERE d.id = ${doc.id} AND d.status IN ('active', 'draft')
          AND NOT EXISTS (SELECT 1 FROM carecore_documents n WHERE n.previous_id = d.id AND n.status IN ('draft', 'active'))`,
      ...(publish
        ? [ctx.sql`UPDATE carecore_documents SET status = 'superseded', updated_at = NOW() WHERE id = ${doc.id}`]
        : []),
      ctx.sql`INSERT INTO carecore_document_reads (document_id, user_id, acknowledged_at) VALUES (${id}, ${ctx.actor.id}, NOW())`,
      auditStatement(
        ctx,
        doc.kind,
        id,
        "versioned",
        { id: doc.id, versionNo: doc.versionNo },
        { versionNo, note, publish },
      ),
      ...(publish && doc.kind === "standard" && doc.requiresAck ? [notifyStandard(ctx, id, doc.title, versionNo)] : []),
    ]);
  } catch (error) {
    if (String(error).includes("carecore_document_reads"))
      throw new ApiError("Zu diesem Dokument gibt es bereits eine neue Version (Entwurf).", 409);
    throw error;
  }
  return id;
}

export async function documentAction(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  const doc = await loadDocument(ctx, idInput);
  const { sql, actor } = ctx;
  if (body.action === "read" || body.action === "ack") {
    const ack = body.action === "ack";
    if (ack && !doc.requiresAck) throw new ApiError("Für dieses Dokument ist keine Bestätigung nötig.", 409);
    await sql.transaction([
      sql`
        INSERT INTO carecore_document_reads (document_id, user_id, acknowledged_at) VALUES (${doc.id}, ${actor.id}, ${ack ? new Date().toISOString() : null})
        ON CONFLICT (document_id, user_id) DO UPDATE SET acknowledged_at = COALESCE(carecore_document_reads.acknowledged_at, EXCLUDED.acknowledged_at)`,
      ...(ack && !doc.acknowledgedAt ? [auditStatement(ctx, doc.kind, doc.id, "acknowledged", null, null)] : []),
    ]);
    return;
  }
  if (!doc.canEdit) throw new ApiError("Keine Berechtigung für dieses Dokument.", 403);
  if (body.action === "update") {
    if (doc.status !== "active" && doc.status !== "draft")
      throw new ApiError("Archivierte und ersetzte Versionen bleiben unverändert.", 409);
    const meta = parseMeta(doc.kind, { get: (key: string) => body[key] });
    await sql.transaction([
      sql`
        UPDATE carecore_documents SET title = ${meta.title}, category = ${meta.category}, description = ${meta.description},
          review_due_on = ${meta.reviewDueOn}, requires_ack = ${meta.requiresAck}, updated_at = NOW() WHERE id = ${doc.id}`,
      auditStatement(
        ctx,
        doc.kind,
        doc.id,
        "updated",
        {
          title: doc.title,
          category: doc.category,
          description: doc.description,
          reviewDueOn: doc.reviewDueOn,
          requiresAck: doc.requiresAck,
        },
        meta,
      ),
      // Wird die Bestätigung nachträglich verlangt, erfahren es alle, die den gültigen Standard noch nicht bestätigt haben.
      ...(doc.kind === "standard" && doc.status === "active" && meta.requiresAck && !doc.requiresAck
        ? [notifyStandard(ctx, doc.id, meta.title, doc.versionNo, true)]
        : []),
    ]);
    return;
  }
  if (body.action === "publish") {
    if (doc.status !== "draft") throw new ApiError("Nur Entwürfe können freigegeben werden.", 409);
    if (doc.kind === "standard" && !canManage(ctx, "standard"))
      throw new ApiError("Standards gibt das Qualitätsmanagement frei.", 403);
    await sql.transaction([
      sql`
        UPDATE carecore_documents SET status = 'active', approved_by = ${actor.id}, approved_at = NOW(), updated_at = NOW()
        WHERE id = ${doc.id}`,
      ...(doc.previousId
        ? [
            sql`UPDATE carecore_documents SET status = 'superseded', updated_at = NOW() WHERE id = ${doc.previousId} AND status = 'active'`,
          ]
        : []),
      auditStatement(ctx, doc.kind, doc.id, "published", { status: doc.status }, { status: "active" }),
      ...(doc.kind === "standard" && doc.requiresAck ? [notifyStandard(ctx, doc.id, doc.title, doc.versionNo)] : []),
    ]);
    return;
  }
  if (body.action === "archive") {
    if (doc.status === "archived") throw new ApiError("Das Dokument ist bereits archiviert.", 409);
    const reason = text(body.reason, 1000);
    if (!reason) throw new ApiError("Bitte einen Grund angeben.");
    await sql.transaction([
      sql`
        UPDATE carecore_documents SET status = 'archived', archived_at = NOW(), archived_by = ${actor.id},
          archive_reason = ${reason}, updated_at = NOW() WHERE id = ${doc.id}`,
      auditStatement(ctx, doc.kind, doc.id, "archived", { status: doc.status }, { reason }),
    ]);
    return;
  }
  throw new ApiError("Unbekannte Aktion.");
}
