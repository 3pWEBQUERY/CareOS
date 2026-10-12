import { randomUUID } from "node:crypto";
import {
  ApiError,
  assertUuid,
  auditStatement,
  iso,
  text,
  type ApiContext,
  type Row,
  type Sql,
} from "@/lib/api-context";
import { portalResidents, type PortalActor } from "@/lib/portal";
import type { PortalKind, PortalMessage, PortalThread } from "@/lib/portal-shared";
import { hasPermission } from "@/lib/server-data";

// Nachrichten zwischen Portal-Zugängen (Angehörige, Ärztinnen/Ärzte, Apotheke) und der Pflege. Eine Unterhaltung
// gehört zu einem Zugang und optional zu einer Person, für die der Zugang die Freigabe „Nachrichten“ hat; die
// Apotheke darf der Einrichtung immer schreiben. In der Pflege lesen und antworten, wer Akten bearbeiten darf; die
// Apotheke betreuen, wer Verordnungen verwaltet. Neue Nachrichten melden sich den zuständigen Mitarbeitenden.

const PREVIEW = 140;

type ThreadRow = Row & { id: string };

const mapThread = (row: Row, side: "portal" | "staff"): PortalThread => ({
  id: String(row.id),
  subject: String(row.subject),
  residentId: (row.resident_id as string | null) ?? null,
  residentName: (row.resident_name as string | null) ?? null,
  accountId: String(row.account_id),
  accountName: String(row.account_name),
  accountKind: row.account_kind as PortalKind,
  lastMessageAt: iso(row.last_message_at) ?? "",
  lastMessage: String(row.last_message ?? "").slice(0, PREVIEW),
  unread:
    side === "portal"
      ? !row.portal_read_at || String(iso(row.portal_read_at)) < String(iso(row.last_staff_at) ?? "")
      : !row.staff_read_at || String(iso(row.staff_read_at)) < String(iso(row.last_portal_at) ?? ""),
});

const threadSelect = (sql: Sql, where: { organizationId: string; accountId?: string; threadId?: string }) => sql`
  SELECT t.*, a.display_name AS account_name, a.kind AS account_kind,
    NULLIF(TRIM(COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')), '') AS resident_name,
    (SELECT body FROM carecore_portal_messages m WHERE m.thread_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_message,
    (SELECT MAX(created_at) FROM carecore_portal_messages m WHERE m.thread_id = t.id AND m.sender = 'staff') AS last_staff_at,
    (SELECT MAX(created_at) FROM carecore_portal_messages m WHERE m.thread_id = t.id AND m.sender = 'portal') AS last_portal_at
  FROM carecore_portal_threads t
  JOIN carecore_portal_accounts a ON a.id = t.account_id
  LEFT JOIN carecore_residents r ON r.id = t.resident_id
  WHERE t.organization_id = ${where.organizationId}
    AND (${where.accountId ?? null}::uuid IS NULL OR t.account_id = ${where.accountId ?? null}::uuid)
    AND (${where.threadId ?? null}::uuid IS NULL OR t.id = ${where.threadId ?? null}::uuid)
  ORDER BY t.last_message_at DESC
  LIMIT 200`;

async function messagesOf(sql: Sql, threadId: string): Promise<PortalMessage[]> {
  const rows = (await sql`
    SELECT m.id, m.sender, m.body, m.created_at, u.display_name AS staff_name, a.display_name AS account_name
    FROM carecore_portal_messages m
    JOIN carecore_portal_threads t ON t.id = m.thread_id
    JOIN carecore_portal_accounts a ON a.id = t.account_id
    LEFT JOIN carecore_users u ON u.id = m.sender_user_id
    WHERE m.thread_id = ${threadId} ORDER BY m.created_at`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    sender: row.sender as "portal" | "staff",
    senderName: row.sender === "staff" ? String(row.staff_name ?? "Pflege") : String(row.account_name),
    body: String(row.body),
    createdAt: iso(row.created_at) ?? "",
  }));
}

const cleanBody = (value: unknown) => {
  const body = typeof value === "string" ? value.trim().slice(0, 4000) : "";
  if (!body) throw new ApiError("Bitte eine Nachricht schreiben.");
  return body;
};

// Empfänger in der Pflege: für eine Person die Mitarbeitenden ihres Wohnbereichs, die Akten bearbeiten dürfen;
// für die Apotheke, wer Verordnungen verwaltet; sonst die Administration.
function notifyStaff(
  sql: Sql,
  organizationId: string,
  residentId: string | null,
  pharmacy: boolean,
  title: string,
  body: string,
  threadId: string,
) {
  const permission =
    pharmacy && !residentId ? "medication.manage" : residentId ? "residents.write" : "administration.manage";
  return sql`
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    SELECT gen_random_uuid(), u.id, ${title}, ${body.slice(0, PREVIEW)}, 'message_portal', 'normal',
      ${`/c/carecore-one/portal-nachrichten?thread=${threadId}`}, 'portal_thread', ${threadId}
    FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${organizationId} AND u.active AND u.archived_at IS NULL
      AND carecore_effective_permissions(u.id) ? ${permission}
      AND (${residentId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM carecore_unit_memberships um
        JOIN carecore_resident_stays st ON st.care_unit_id = um.care_unit_id AND st.ended_at IS NULL
        WHERE um.user_id = u.id AND st.resident_id = ${residentId}::uuid))`;
}

// ---------- Portal ----------

async function portalMayWrite(sql: Sql, actor: PortalActor, residentId: string | null) {
  const residents = await portalResidents(sql, actor);
  if (residentId) {
    const resident = residents.find((entry) => entry.id === residentId);
    if (!resident?.areas.includes("messages"))
      throw new ApiError("Für diese Person sind keine Nachrichten freigegeben.", 403);
    return;
  }
  if (actor.kind !== "pharmacy" && !residents.some((entry) => entry.areas.includes("messages")))
    throw new ApiError("Nachrichten sind für diesen Zugang nicht freigegeben.", 403);
}

export async function portalThreads(sql: Sql, actor: PortalActor) {
  const rows = (await threadSelect(sql, { organizationId: actor.organizationId, accountId: actor.id })) as ThreadRow[];
  return rows.map((row) => mapThread(row, "portal"));
}

export async function portalThread(sql: Sql, actor: PortalActor, threadInput: unknown) {
  const threadId = assertUuid(threadInput, "Unterhaltung");
  const [row] = (await threadSelect(sql, {
    organizationId: actor.organizationId,
    accountId: actor.id,
    threadId,
  })) as ThreadRow[];
  if (!row) throw new ApiError("Unterhaltung nicht gefunden.", 404);
  await sql`UPDATE carecore_portal_threads SET portal_read_at = NOW() WHERE id = ${threadId}`;
  return { ...mapThread(row, "portal"), unread: false, messages: await messagesOf(sql, threadId) };
}

// Neue Unterhaltung ({ subject, residentId?, body }) oder Antwort ({ threadId, body }).
export async function portalSend(sql: Sql, actor: PortalActor, input: Record<string, unknown>) {
  const body = cleanBody(input.body);
  let threadId: string;
  let residentId: string | null;
  let subject: string;
  if (input.threadId) {
    threadId = assertUuid(input.threadId, "Unterhaltung");
    const [row] = (await sql`
      SELECT resident_id, subject FROM carecore_portal_threads WHERE id = ${threadId} AND account_id = ${actor.id}`) as Row[];
    if (!row) throw new ApiError("Unterhaltung nicht gefunden.", 404);
    residentId = (row.resident_id as string | null) ?? null;
    subject = String(row.subject);
  } else {
    threadId = randomUUID();
    residentId = input.residentId ? assertUuid(input.residentId, "Person") : null;
    subject = text(input.subject, 160);
    if (!subject) throw new ApiError("Bitte einen Betreff angeben.");
  }
  await portalMayWrite(sql, actor, residentId);
  await sql.transaction([
    ...(input.threadId
      ? []
      : [
          sql`
            INSERT INTO carecore_portal_threads (id, organization_id, account_id, resident_id, subject, started_by, portal_read_at)
            VALUES (${threadId}, ${actor.organizationId}, ${actor.id}, ${residentId}, ${subject}, 'portal', NOW())`,
        ]),
    sql`INSERT INTO carecore_portal_messages (id, thread_id, sender, body) VALUES (${randomUUID()}, ${threadId}, 'portal', ${body})`,
    sql`UPDATE carecore_portal_threads SET last_message_at = NOW(), portal_read_at = NOW() WHERE id = ${threadId}`,
    sql`
      INSERT INTO carecore_portal_access_log (id, organization_id, account_id, resident_id, action, user_agent)
      VALUES (${randomUUID()}, ${actor.organizationId}, ${actor.id}, ${residentId}, 'message_sent', ${actor.userAgent?.slice(0, 300) ?? null})`,
    notifyStaff(
      sql,
      actor.organizationId,
      residentId,
      actor.kind === "pharmacy",
      `Portal: ${actor.displayName}`,
      `${subject}: ${body}`,
      threadId,
    ),
  ]);
  return threadId;
}

// ---------- Pflege ----------

const mayAnswer = (ctx: ApiContext, thread: { residentId: string | null; accountKind: PortalKind }) =>
  thread.residentId
    ? hasPermission(ctx.actor, "residents.write")
    : thread.accountKind === "pharmacy"
      ? hasPermission(ctx.actor, "medication.manage") || hasPermission(ctx.actor, "administration.manage")
      : hasPermission(ctx.actor, "administration.manage");

export async function staffThreads(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "residents.read")) throw new ApiError("Keine Berechtigung.", 403);
  const rows = (await threadSelect(ctx.sql, { organizationId: ctx.actor.organizationId })) as ThreadRow[];
  return rows.map((row) => mapThread(row, "staff")).filter((thread) => mayAnswer(ctx, thread));
}

export async function staffThread(ctx: ApiContext, threadInput: unknown) {
  const threadId = assertUuid(threadInput, "Unterhaltung");
  const [row] = (await threadSelect(ctx.sql, { organizationId: ctx.actor.organizationId, threadId })) as ThreadRow[];
  const thread = row ? mapThread(row, "staff") : null;
  if (!thread || !mayAnswer(ctx, thread)) throw new ApiError("Unterhaltung nicht gefunden.", 404);
  await ctx.sql`UPDATE carecore_portal_threads SET staff_read_at = NOW() WHERE id = ${threadId}`;
  return { ...thread, unread: false, messages: await messagesOf(ctx.sql, threadId) };
}

// Antwort ({ threadId, body }) oder neue Unterhaltung an einen Zugang ({ accountId, residentId?, subject, body }).
export async function staffSend(ctx: ApiContext, input: Record<string, unknown>) {
  const body = cleanBody(input.body);
  if (input.threadId) {
    const thread = await staffThread(ctx, input.threadId);
    await ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_portal_messages (id, thread_id, sender, sender_user_id, body)
        VALUES (${randomUUID()}, ${thread.id}, 'staff', ${ctx.actor.id}, ${body})`,
      ctx.sql`UPDATE carecore_portal_threads SET last_message_at = NOW(), staff_read_at = NOW() WHERE id = ${thread.id}`,
      auditStatement(ctx, "portal_thread", thread.id, "answered", null, { accountId: thread.accountId }),
    ]);
    return thread.id;
  }
  const accountId = assertUuid(input.accountId, "Portal-Zugang");
  const [account] = (await ctx.sql`
    SELECT id, kind FROM carecore_portal_accounts
    WHERE id = ${accountId} AND organization_id = ${ctx.actor.organizationId} AND active`) as Row[];
  if (!account) throw new ApiError("Portal-Zugang nicht gefunden.", 404);
  const residentId = input.residentId ? assertUuid(input.residentId, "Person") : null;
  const subject = text(input.subject, 160);
  if (!subject) throw new ApiError("Bitte einen Betreff angeben.");
  if (!mayAnswer(ctx, { residentId, accountKind: account.kind as PortalKind }))
    throw new ApiError("Keine Berechtigung für diese Nachricht.", 403);
  if (residentId) {
    const granted = await portalResidents(ctx.sql, {
      id: accountId,
      organizationId: ctx.actor.organizationId,
      kind: account.kind as PortalKind,
      displayName: "",
      mustChangePassword: false,
      userAgent: null,
    });
    if (!granted.find((entry) => entry.id === residentId)?.areas.includes("messages"))
      throw new ApiError("Für diese Person und diesen Zugang sind keine Nachrichten freigegeben.", 403);
  }
  const threadId = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_portal_threads (id, organization_id, account_id, resident_id, subject, started_by, staff_read_at)
      VALUES (${threadId}, ${ctx.actor.organizationId}, ${accountId}, ${residentId}, ${subject}, 'staff', NOW())`,
    ctx.sql`
      INSERT INTO carecore_portal_messages (id, thread_id, sender, sender_user_id, body)
      VALUES (${randomUUID()}, ${threadId}, 'staff', ${ctx.actor.id}, ${body})`,
    auditStatement(ctx, "portal_thread", threadId, "started", null, { accountId, residentId, subject }),
  ]);
  return threadId;
}

// Zugänge, denen die Pflege schreiben kann (für „Neue Nachricht“).
export async function messageRecipients(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT id, display_name, kind FROM carecore_portal_accounts
    WHERE organization_id = ${ctx.actor.organizationId} AND active ORDER BY LOWER(display_name)`) as Row[];
  return rows.map((row) => ({ id: String(row.id), name: String(row.display_name), kind: row.kind as PortalKind }));
}
