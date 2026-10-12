import { randomUUID } from "node:crypto";
import {
  ApiError,
  assertResident,
  assertUuid,
  iso,
  text,
  auditStatement,
  type ApiContext,
  type Row,
} from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { receiptStatements, withReceipt } from "@/lib/request-receipts";
import { DOC_CATEGORIES, IMPORTANCE, type DocEntry, type DocStats, type Importance } from "@/lib/documentation-shared";

const UUID = /^[0-9a-f-]{36}$/i;

function mapEntry(row: Row): DocEntry {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    residentId: String(row.resident_id),
    residentName: String(row.resident_name),
    room: String(row.room ?? ""),
    category: String(row.category),
    body: String(row.body),
    importance: (row.importance as Importance) ?? "standard",
    occurredAt: iso(row.occurred_at) ?? "",
    createdAt: iso(row.created_at) ?? "",
    author: (row.author as string | null) ?? null,
    amendedFromId: (row.amended_from_id as string | null) ?? null,
    amendReason: typeof metadata.amendReason === "string" ? metadata.amendReason : null,
    amendedBy: row.amended_by_id
      ? {
          id: String(row.amended_by_id),
          createdAt: iso(row.amended_by_at) ?? "",
          author: (row.amended_by_author as string | null) ?? null,
        }
      : null,
  };
}

export async function listEntries(ctx: ApiContext, params: URLSearchParams): Promise<DocEntry[]> {
  const residentId = UUID.test(params.get("residentId") ?? "") ? params.get("residentId") : null;
  const category = (DOC_CATEGORIES as readonly string[]).includes(params.get("category") ?? "")
    ? params.get("category")
    : null;
  const importance =
    params.get("importance") && params.get("importance")! in IMPORTANCE ? params.get("importance") : null;
  const days = [1, 7, 30, 90].includes(Number(params.get("days"))) ? Number(params.get("days")) : 7;
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const rows = (await ctx.sql`
    SELECT d.*, r.first_name || ' ' || r.last_name AS resident_name, COALESCE(ro.name, '') AS room,
      COALESCE(u.display_name, d.metadata ->> 'portalAuthor') AS author,
      fix.id AS amended_by_id, fix.created_at AS amended_by_at, fu.display_name AS amended_by_author
    FROM carecore_documentation_entries d
    JOIN carecore_residents r ON r.id = d.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    LEFT JOIN carecore_users u ON u.id = d.author_user_id
    LEFT JOIN LATERAL (SELECT id, created_at, author_user_id FROM carecore_documentation_entries WHERE amended_from_id = d.id ORDER BY created_at DESC LIMIT 1) fix ON TRUE
    LEFT JOIN carecore_users fu ON fu.id = fix.author_user_id
    WHERE d.occurred_at > NOW() - make_interval(days => ${days})
      AND (${residentId}::uuid IS NULL OR d.resident_id = ${residentId}::uuid)
      AND (${category}::text IS NULL OR d.category = ${category})
      AND (${importance}::text IS NULL OR d.importance = ${importance})
      AND (${query} = '' OR d.body ILIKE '%' || ${query} || '%' OR (r.first_name || ' ' || r.last_name) ILIKE '%' || ${query} || '%')
    ORDER BY d.occurred_at DESC, d.created_at DESC
    LIMIT 300`) as Row[];
  return rows.map(mapEntry);
}

export async function documentationStats(ctx: ApiContext): Promise<DocStats> {
  const [counts, perDay, without] = (await Promise.all([
    ctx.sql`
      SELECT COUNT(*)::int AS today, COUNT(*) FILTER (WHERE d.author_user_id = ${ctx.actor.id})::int AS mine
      FROM carecore_documentation_entries d
      JOIN carecore_residents r ON r.id = d.resident_id AND r.organization_id = ${ctx.actor.organizationId}
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      WHERE (d.created_at AT TIME ZONE org.tz)::date = (NOW() AT TIME ZONE org.tz)::date`,
    ctx.sql`
      SELECT to_char(day.d, 'YYYY-MM-DD') AS date, COUNT(d.id)::int AS count
      FROM (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      CROSS JOIN generate_series((NOW() AT TIME ZONE org.tz)::date - 6, (NOW() AT TIME ZONE org.tz)::date, INTERVAL '1 day') AS day(d)
      LEFT JOIN carecore_documentation_entries d ON (d.occurred_at AT TIME ZONE org.tz)::date = day.d::date
        AND d.resident_id IN (SELECT id FROM carecore_residents WHERE organization_id = ${ctx.actor.organizationId})
      GROUP BY day.d ORDER BY day.d`,
    ctx.sql`
      SELECT r.id, r.first_name || ' ' || r.last_name AS name, COALESCE(ro.name, '') AS room, last.at AS last_at
      FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      LEFT JOIN LATERAL (SELECT MAX(occurred_at) AS at FROM carecore_documentation_entries WHERE resident_id = r.id) last ON TRUE
      WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
        AND (last.at IS NULL OR last.at < NOW() - INTERVAL '24 hours')
      ORDER BY last.at NULLS FIRST, r.last_name`,
  ])) as Row[][];
  return {
    todayCount: Number(counts[0].today),
    myTodayCount: Number(counts[0].mine),
    perDay: perDay.map((row) => ({ date: String(row.date), count: Number(row.count) })),
    withoutEntry: without.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      room: String(row.room),
      lastAt: iso(row.last_at),
    })),
  };
}

function parseEntry(body: Record<string, unknown>) {
  const category =
    typeof body.category === "string" && (DOC_CATEGORIES as readonly string[]).includes(body.category)
      ? body.category
      : null;
  if (!category) throw new ApiError("Bitte die Dokumentationsart wählen.");
  const content = text(body.body, 10000);
  if (content.length < 3) throw new ApiError("Bitte den Eintrag formulieren.");
  const importance =
    typeof body.importance === "string" && body.importance in IMPORTANCE ? (body.importance as Importance) : "standard";
  const occurredAt =
    typeof body.occurredAt === "string" && !Number.isNaN(Date.parse(body.occurredAt))
      ? new Date(body.occurredAt)
      : new Date();
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new ApiError("Der Zeitpunkt liegt in der Zukunft.");
  if (occurredAt.getTime() < Date.now() - 7 * 86_400_000)
    throw new ApiError("Einträge können höchstens 7 Tage rückwirkend erfasst werden.");
  return { category, content, importance, occurredAt: occurredAt.toISOString() };
}

// Mit `requestId` (Offline-Warteschlange) wird eine wiederholte Anfrage nicht erneut gespeichert (Ergebnis null).
export async function createEntry(ctx: ApiContext, body: Record<string, unknown>, requestId: string | null = null) {
  const residentId = await assertResident(ctx, body.residentId);
  const entry = parseEntry(body);
  const id = randomUUID();
  const { repeated } = await withReceipt(() =>
    ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body, occurred_at, importance)
        SELECT ${id}, ${residentId},
          (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1),
          ${ctx.actor.id}, ${entry.category}, ${entry.category}, ${entry.content}, ${entry.occurredAt}, ${entry.importance}`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "documentation_entry",
        entityId: id,
        action: "created",
        after: { category: entry.category, importance: entry.importance },
      }),
      ...receiptStatements(ctx, requestId),
    ]),
  );
  return repeated ? null : id;
}

// A correction is a new entry referencing the original; the original stays unchanged and visible.
export async function amendEntry(ctx: ApiContext, entryIdInput: unknown, body: Record<string, unknown>) {
  const originalId = assertUuid(entryIdInput, "Eintrag");
  const rows = (await ctx.sql`
    SELECT d.* FROM carecore_documentation_entries d
    JOIN carecore_residents r ON r.id = d.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    WHERE d.id = ${originalId}`) as Row[];
  const original = rows[0];
  if (!original) throw new ApiError("Eintrag nicht gefunden.", 404);
  const reason = text(body.reason, 1000);
  if (!reason) throw new ApiError("Bitte den Grund für die Korrektur angeben.");
  const content = text(body.body, 10000);
  if (content.length < 3) throw new ApiError("Bitte den korrigierten Eintrag formulieren.");
  const importance =
    typeof body.importance === "string" && body.importance in IMPORTANCE
      ? body.importance
      : String(original.importance);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body, occurred_at, importance, metadata, amended_from_id)
    VALUES (${id}, ${original.resident_id}, ${original.care_unit_id}, ${ctx.actor.id}, ${original.category}, ${original.category}, ${content},
      ${iso(original.occurred_at)}, ${importance}, ${JSON.stringify({ amendReason: reason })}::jsonb, ${originalId})`,
    auditStatement(
      ctx,
      "documentation_entry",
      id,
      "amended",
      { id: originalId, body: original.body },
      { body: content, reason },
    ),
  ]);
  return id;
}
