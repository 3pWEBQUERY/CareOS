import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, iso, type ApiContext, type Row } from "@/lib/api-context";
import {
  MESSAGE_PRIORITIES,
  MESSAGE_REACTIONS,
  mentionedMembers,
  mentionsEveryone,
  plainPreview,
  type ChatAttachment,
  type ChatConversation,
  type ChatFile,
  type ChatMember,
  type ChatMessage,
  type ChatPayload,
  type ChatPerson,
  type ChatSummary,
  type DutyState,
  type MessagePriority,
  type MessageReaction,
  type ReactionSummary,
} from "@/lib/messenger-shared";
import { mediaContent, storeMedia } from "@/lib/storage";
import { onDutyPeople, onDutyRows } from "@/lib/team-news";
import { FILE_MAX_BYTES } from "@/lib/files-shared";

// Messenger von Kommunikation (wie der Chat eines Teams, ergänzt um den Pflegealltag):
// Direktnachrichten und Gruppen, Antworten mit Zitat, Reaktionen, @Erwähnungen (auch @alle), Wichtigkeit
// („wichtig“, „dringend“), Dateien (hochgeladen oder aus der Ablage verknüpft), angeheftete Nachrichten,
// Bearbeiten und Löschen eigener Nachrichten, Gelesen-Status und wer gerade im Dienst ist.

type Membership = {
  user_id: string;
  display_name: string;
  kind: string;
  title: string | null;
  created_by: string | null;
  muted: boolean;
};

async function membersOf(ctx: ApiContext, conversationId: string) {
  const rows = (await ctx.sql`
    SELECT cm.user_id, u.display_name, c.kind, c.title, c.created_by, cm.muted
    FROM carecore_conversation_members cm
    JOIN carecore_conversations c ON c.id = cm.conversation_id AND c.organization_id = ${ctx.actor.organizationId}
    JOIN carecore_users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ${conversationId}`) as Row[];
  if (!rows.some((row) => row.user_id === ctx.actor.id))
    throw new ApiError("Kein Zugriff auf diese Unterhaltung.", 403);
  return rows.map((row): Membership => ({
    user_id: String(row.user_id),
    display_name: String(row.display_name),
    kind: String(row.kind),
    title: (row.title as string | null) ?? null,
    created_by: row.created_by ? String(row.created_by) : null,
    muted: Boolean(row.muted),
  }));
}

async function loadMessage(ctx: ApiContext, messageInput: unknown) {
  const messageId = assertUuid(messageInput, "Nachricht");
  const rows = (await ctx.sql`
    SELECT id, conversation_id, author_user_id, kind, deleted_at, pinned_at FROM carecore_messages WHERE id = ${messageId}`) as Row[];
  if (!rows[0]) throw new ApiError("Nachricht nicht gefunden.", 404);
  await membersOf(ctx, String(rows[0].conversation_id));
  return rows[0];
}

const preview = (text: string) => plainPreview(text);

// Datei für eine Nachricht: in dieser Unterhaltung hochgeladen, aus der gemeinsamen Ablage (verknüpft) oder aus
// „Meine Dateien“ (wird als Kopie in die Unterhaltung gestellt, damit die Mitglieder sie öffnen können).
async function attachmentFor(ctx: ApiContext, conversationId: string, fileInput: unknown): Promise<ChatAttachment> {
  const fileId = assertUuid(fileInput, "Datei");
  const rows = (await ctx.sql`
    SELECT id, name, mime_type, size_bytes, purpose, uploaded_by, conversation_id, content_base64, storage_key
    FROM carecore_cloud_files
    WHERE id = ${fileId} AND organization_id = ${ctx.actor.organizationId} AND deleted_at IS NULL`) as Row[];
  const file = rows[0];
  const meta = (row: Row, source: ChatAttachment["source"]): ChatAttachment => ({
    id: String(row.id),
    name: String(row.name),
    mimeType: String(row.mime_type ?? ""),
    sizeBytes: Number(row.size_bytes),
    source,
    available: true,
  });
  if (file?.purpose === "shared") return meta(file, "shared");
  if (file?.purpose === "chat" && file.conversation_id === conversationId) return meta(file, "chat");
  if (file?.purpose === "cloud" && file.uploaded_by === ctx.actor.id) {
    const content = await mediaContent(file.storage_key, file.content_base64);
    if (!content) throw new ApiError("Der Inhalt der Datei ist nicht verfügbar.", 404);
    return storeChatFile(ctx, conversationId, String(file.name), String(file.mime_type), content);
  }
  throw new ApiError("Datei nicht gefunden.", 404);
}

async function storeChatFile(ctx: ApiContext, conversationId: string, name: string, type: string, content: Buffer) {
  const id = randomUUID();
  const storageKey = await storeMedia("files", ctx.actor.organizationId, id, content, type);
  await ctx.sql`
    INSERT INTO carecore_cloud_files (id, organization_id, name, mime_type, size_bytes, content_base64, storage_key, uploaded_by, updated_by, purpose, conversation_id)
    VALUES (${id}, ${ctx.actor.organizationId}, ${name.slice(0, 220)}, ${type}, ${content.length},
      ${storageKey ? null : content.toString("base64")}, ${storageKey}, ${ctx.actor.id}, ${ctx.actor.id}, 'chat', ${conversationId})`;
  return { id, name, mimeType: type, sizeBytes: content.length, source: "chat" as const, available: true };
}

// Datei vom Gerät in eine Unterhaltung hochladen (danach mit der Nachricht senden).
export async function uploadChatFile(ctx: ApiContext, conversationInput: unknown, file: unknown) {
  const conversationId = assertUuid(conversationInput, "Unterhaltung");
  await membersOf(ctx, conversationId);
  if (!(file instanceof File) || file.size === 0) throw new ApiError("Bitte wähle eine Datei aus.");
  if (file.size > FILE_MAX_BYTES) throw new ApiError("Dateien dürfen höchstens 4 MB gross sein.", 413);
  const name = file.name.trim().replace(/[\\/\u0000-\u001f]/g, "-") || "Datei";
  return storeChatFile(
    ctx,
    conversationId,
    name,
    file.type || "application/octet-stream",
    Buffer.from(await file.arrayBuffer()),
  );
}

export type SendOptions = { replyToId?: unknown; priority?: unknown; attachmentIds?: unknown };

// Nachricht senden. Benachrichtigt werden: bei Direktnachrichten die andere Person, in Gruppen die Erwähnten
// (auch @alle); „dringend“ erreicht alle Mitglieder. Wer eine Unterhaltung stummgeschaltet hat, erhält nur
// Erwähnungen und dringende Nachrichten.
export async function sendMessage(
  ctx: ApiContext,
  conversationInput: unknown,
  textInput: unknown,
  options: SendOptions = {},
) {
  const conversationId = assertUuid(conversationInput, "Unterhaltung");
  const text = typeof textInput === "string" ? textInput.trim().slice(0, 5000) : "";
  const members = await membersOf(ctx, conversationId);
  const ids = Array.isArray(options.attachmentIds) ? [...new Set(options.attachmentIds)].slice(0, 10) : [];
  if (!text && !ids.length) throw new ApiError("Die Nachricht darf nicht leer sein.");
  const attachments: ChatAttachment[] = [];
  for (const id of ids) attachments.push(await attachmentFor(ctx, conversationId, id));
  const priority: MessagePriority =
    typeof options.priority === "string" && options.priority in MESSAGE_PRIORITIES
      ? (options.priority as MessagePriority)
      : "normal";
  let replyToId: string | null = null;
  if (options.replyToId) {
    replyToId = assertUuid(options.replyToId, "Antwort");
    const rows =
      (await ctx.sql`SELECT id FROM carecore_messages WHERE id = ${replyToId} AND conversation_id = ${conversationId}`) as Row[];
    if (!rows[0]) throw new ApiError("Die Nachricht, auf die du antwortest, gibt es nicht mehr.", 404);
  }
  const direct = members[0]?.kind === "direct";
  const everyone = !direct && mentionsEveryone(text);
  const mentions = (everyone ? members.map((member) => member.user_id) : mentionedMembers(text, members)).filter(
    (id) => id !== ctx.actor.id,
  );
  const place = direct ? "Direktnachricht" : (members[0]?.title ?? "Gruppe");
  const summary = preview(text || attachments.map((file) => `📎 ${file.name}`).join(", "));
  const link = `/c/carecore-one/messenger?conversation=${conversationId}`;
  const id = randomUUID();
  const recipients = members.filter((member) => {
    if (member.user_id === ctx.actor.id) return false;
    if (priority === "urgent" || mentions.includes(member.user_id)) return true;
    return direct && !member.muted;
  });
  const notice = (userId: string) => {
    if (priority === "urgent")
      return { title: `Dringend: ${ctx.actor.display_name}`, type: "message_urgent", priority: "high" };
    if (mentions.includes(userId))
      return { title: `${ctx.actor.display_name} hat dich erwähnt`, type: "message_mention", priority: "high" };
    return { title: `Nachricht von ${ctx.actor.display_name}`, type: "message_direct", priority: "normal" };
  };
  await ctx.sql.transaction([
    ctx.sql`INSERT INTO carecore_messages (id, conversation_id, author_user_id, body, mentions, attachments, reply_to_id, priority)
      VALUES (${id}, ${conversationId}, ${ctx.actor.id}, ${text}, ${JSON.stringify(mentions)}::jsonb,
        ${JSON.stringify(attachments)}::jsonb, ${replyToId}, ${priority})`,
    ctx.sql`UPDATE carecore_conversations SET updated_at = NOW() WHERE id = ${conversationId}`,
    ctx.sql`UPDATE carecore_conversation_members SET last_read_at = NOW() WHERE conversation_id = ${conversationId} AND user_id = ${ctx.actor.id}`,
    ...recipients.map((member) => {
      const note = notice(member.user_id);
      return ctx.sql`
        INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
        VALUES (${randomUUID()}, ${member.user_id}, ${note.title}, ${`${place}: ${summary}`}, ${note.type}, ${note.priority},
          ${link}, 'message', ${id})`;
    }),
  ]);
  return { id, mentions };
}

async function systemMessage(ctx: ApiContext, conversationId: string, text: string) {
  return [
    ctx.sql`INSERT INTO carecore_messages (id, conversation_id, author_user_id, body, kind)
      VALUES (${randomUUID()}, ${conversationId}, ${ctx.actor.id}, ${text}, 'system')`,
    ctx.sql`UPDATE carecore_conversations SET updated_at = NOW() WHERE id = ${conversationId}`,
  ];
}

// Eigene Nachricht bearbeiten (Hinweis „bearbeitet“; Erwähnungen werden neu bestimmt, ohne erneute Benachrichtigung).
export async function editMessage(ctx: ApiContext, messageInput: unknown, textInput: unknown) {
  const message = await loadMessage(ctx, messageInput);
  if (message.author_user_id !== ctx.actor.id || message.kind !== "text")
    throw new ApiError("Bearbeiten lassen sich nur eigene Nachrichten.", 403);
  if (message.deleted_at) throw new ApiError("Die Nachricht wurde gelöscht.", 409);
  const text = typeof textInput === "string" ? textInput.trim().slice(0, 5000) : "";
  if (!text) throw new ApiError("Die Nachricht darf nicht leer sein.");
  const members = await membersOf(ctx, String(message.conversation_id));
  const mentions = mentionedMembers(text, members).filter((id) => id !== ctx.actor.id);
  await ctx.sql`UPDATE carecore_messages SET body = ${text}, mentions = ${JSON.stringify(mentions)}::jsonb, edited_at = NOW()
    WHERE id = ${message.id}`;
}

// Eigene Nachricht löschen: Inhalt und Anhänge werden entfernt, die Stelle bleibt als „gelöscht“ sichtbar.
export async function deleteMessage(ctx: ApiContext, messageInput: unknown) {
  const message = await loadMessage(ctx, messageInput);
  if (message.author_user_id !== ctx.actor.id || message.kind !== "text")
    throw new ApiError("Löschen lassen sich nur eigene Nachrichten.", 403);
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_messages SET body = '', attachments = '[]'::jsonb, mentions = '[]'::jsonb, deleted_at = NOW(),
      pinned_at = NULL, pinned_by = NULL WHERE id = ${message.id}`,
    ctx.sql`DELETE FROM carecore_message_reactions WHERE message_id = ${message.id}`,
  ]);
}

// Nachricht für alle Mitglieder oben anheften (z. B. Telefonnummern, Regeln der Gruppe) oder lösen.
export async function pinMessage(ctx: ApiContext, messageInput: unknown, pinned: unknown) {
  const message = await loadMessage(ctx, messageInput);
  if (message.deleted_at || message.kind !== "text") throw new ApiError("Diese Nachricht lässt sich nicht anheften.");
  await ctx.sql`UPDATE carecore_messages SET pinned_at = ${pinned ? new Date().toISOString() : null},
    pinned_by = ${pinned ? ctx.actor.id : null} WHERE id = ${message.id}`;
}

// Persönliche Einstellungen je Unterhaltung: oben anheften, stummschalten, als ungelesen markieren.
export async function updateMembership(ctx: ApiContext, conversationInput: unknown, body: Record<string, unknown>) {
  const conversationId = assertUuid(conversationInput, "Unterhaltung");
  await membersOf(ctx, conversationId);
  if (typeof body.pinned === "boolean")
    await ctx.sql`UPDATE carecore_conversation_members SET pinned = ${body.pinned}
      WHERE conversation_id = ${conversationId} AND user_id = ${ctx.actor.id}`;
  if (typeof body.muted === "boolean")
    await ctx.sql`UPDATE carecore_conversation_members SET muted = ${body.muted}
      WHERE conversation_id = ${conversationId} AND user_id = ${ctx.actor.id}`;
  if (body.unread === true)
    await ctx.sql`
      UPDATE carecore_conversation_members SET last_read_at = (
        SELECT MAX(created_at) - INTERVAL '1 millisecond' FROM carecore_messages
        WHERE conversation_id = ${conversationId} AND author_user_id IS DISTINCT FROM ${ctx.actor.id} AND kind = 'text')
      WHERE conversation_id = ${conversationId} AND user_id = ${ctx.actor.id}`;
}

async function activePeople(ctx: ApiContext, ids: string[]) {
  const unique = [...new Set(ids)].filter((id) => typeof id === "string");
  for (const id of unique) assertUuid(id, "Person");
  const rows = (await ctx.sql`
    SELECT u.id, u.display_name FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active = TRUE AND u.id = ANY(${unique}::uuid[])`) as Row[];
  if (rows.length !== unique.length) throw new ApiError("Eine ausgewählte Person ist nicht verfügbar.");
  return rows.map((row) => ({ id: String(row.id), name: String(row.display_name) }));
}

const names = (list: Array<{ name: string }>) =>
  list.length <= 1
    ? (list[0]?.name ?? "")
    : `${list
        .slice(0, -1)
        .map((item) => item.name)
        .join(", ")} und ${list.at(-1)!.name}`;

// Neue Unterhaltung. Eine Direktnachricht an dieselbe Person öffnet die bestehende Unterhaltung.
export async function createConversation(ctx: ApiContext, body: Record<string, unknown>) {
  const kind = body.kind === "direct" ? "direct" : "group";
  const selected = (Array.isArray(body.memberIds) ? body.memberIds : []).filter(
    (id): id is string => typeof id === "string" && id !== ctx.actor.id,
  );
  if (!selected.length)
    throw new ApiError(
      kind === "direct"
        ? "Wähle eine Person für die Direktnachricht aus."
        : "Wähle mindestens eine Person für die Gruppe aus.",
    );
  if (kind === "direct" && selected.length !== 1) throw new ApiError("Eine Direktnachricht geht an genau eine Person.");
  const people = await activePeople(ctx, selected);
  if (kind === "direct") {
    const existing = (await ctx.sql`
      SELECT c.id FROM carecore_conversations c
      WHERE c.organization_id = ${ctx.actor.organizationId} AND c.kind = 'direct'
        AND EXISTS (SELECT 1 FROM carecore_conversation_members m WHERE m.conversation_id = c.id AND m.user_id = ${ctx.actor.id})
        AND EXISTS (SELECT 1 FROM carecore_conversation_members m WHERE m.conversation_id = c.id AND m.user_id = ${people[0].id})
        AND (SELECT COUNT(*) FROM carecore_conversation_members m WHERE m.conversation_id = c.id) = 2
      ORDER BY c.updated_at DESC LIMIT 1`) as Row[];
    if (existing[0]) return { id: String(existing[0].id), existing: true };
  }
  const title = kind === "direct" ? null : typeof body.title === "string" ? body.title.trim().slice(0, 180) : "";
  if (kind === "group" && !title) throw new ApiError("Bitte gib der Gruppe einen Namen.");
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`INSERT INTO carecore_conversations (id, organization_id, title, kind, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${title}, ${kind}, ${ctx.actor.id})`,
    ...[ctx.actor.id, ...people.map((person) => person.id)].map(
      (userId) => ctx.sql`INSERT INTO carecore_conversation_members (conversation_id, user_id, last_read_at)
        VALUES (${id}, ${userId}, ${userId === ctx.actor.id ? new Date().toISOString() : null})`,
    ),
    ...(kind === "group"
      ? [
          ctx.sql`INSERT INTO carecore_messages (id, conversation_id, author_user_id, body, kind)
            VALUES (${randomUUID()}, ${id}, ${ctx.actor.id}, ${`${ctx.actor.display_name} hat die Gruppe „${title}“ erstellt.`}, 'system')`,
        ]
      : []),
  ]);
  return { id, existing: false };
}

async function groupOf(ctx: ApiContext, conversationInput: unknown) {
  const conversationId = assertUuid(conversationInput, "Unterhaltung");
  const members = await membersOf(ctx, conversationId);
  if (members[0]?.kind === "direct") throw new ApiError("Direktnachrichten haben keine Gruppeneinstellungen.");
  return { conversationId, members };
}

export async function renameConversation(ctx: ApiContext, conversationInput: unknown, titleInput: unknown) {
  const { conversationId, members } = await groupOf(ctx, conversationInput);
  const title = typeof titleInput === "string" ? titleInput.trim().slice(0, 180) : "";
  if (!title) throw new ApiError("Bitte gib der Gruppe einen Namen.");
  if (title === members[0].title) return;
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_conversations SET title = ${title} WHERE id = ${conversationId}`,
    ...(await systemMessage(ctx, conversationId, `${ctx.actor.display_name} hat die Gruppe in „${title}“ umbenannt.`)),
  ]);
}

// Mitglieder hinzufügen: jedes Mitglied darf das (wie im Team); sie sehen den ganzen Verlauf.
export async function addMembers(ctx: ApiContext, conversationInput: unknown, idsInput: unknown) {
  const { conversationId, members } = await groupOf(ctx, conversationInput);
  const ids = (Array.isArray(idsInput) ? idsInput : []).filter(
    (id): id is string => typeof id === "string" && !members.some((member) => member.user_id === id),
  );
  if (!ids.length) throw new ApiError("Bitte mindestens eine neue Person wählen.");
  const people = await activePeople(ctx, ids);
  await ctx.sql.transaction([
    ...people.map(
      (
        person,
      ) => ctx.sql`INSERT INTO carecore_conversation_members (conversation_id, user_id) VALUES (${conversationId}, ${person.id})
        ON CONFLICT DO NOTHING`,
    ),
    ...(await systemMessage(ctx, conversationId, `${ctx.actor.display_name} hat ${names(people)} hinzugefügt.`)),
  ]);
}

// Gruppe verlassen (sich selbst entfernen) oder – als Person, die die Gruppe erstellt hat – jemanden entfernen.
export async function removeMember(ctx: ApiContext, conversationInput: unknown, userInput: unknown) {
  const { conversationId, members } = await groupOf(ctx, conversationInput);
  const userId = assertUuid(userInput, "Person");
  const member = members.find((item) => item.user_id === userId);
  if (!member) throw new ApiError("Die Person ist nicht Mitglied dieser Gruppe.", 404);
  const self = userId === ctx.actor.id;
  if (!self && members[0].created_by !== ctx.actor.id)
    throw new ApiError("Mitglieder entfernen darf die Person, die die Gruppe erstellt hat.", 403);
  await ctx.sql.transaction([
    ctx.sql`DELETE FROM carecore_conversation_members WHERE conversation_id = ${conversationId} AND user_id = ${userId}`,
    ...(await systemMessage(
      ctx,
      conversationId,
      self
        ? `${ctx.actor.display_name} hat die Gruppe verlassen.`
        : `${ctx.actor.display_name} hat ${member.display_name} entfernt.`,
    )),
  ]);
}

// Reaktion setzen oder wieder entfernen (nur Mitglieder der Unterhaltung).
export async function toggleReaction(ctx: ApiContext, messageInput: unknown, emojiInput: unknown) {
  const messageId = assertUuid(messageInput, "Nachricht");
  const emoji = String(emojiInput) as MessageReaction;
  if (!MESSAGE_REACTIONS.includes(emoji)) throw new ApiError("Diese Reaktion ist nicht verfügbar.");
  const rows =
    (await ctx.sql`SELECT conversation_id, deleted_at FROM carecore_messages WHERE id = ${messageId}`) as Row[];
  if (!rows[0]) throw new ApiError("Nachricht nicht gefunden.", 404);
  await membersOf(ctx, String(rows[0].conversation_id));
  if (rows[0].deleted_at) throw new ApiError("Die Nachricht wurde gelöscht.", 409);
  const removed = (await ctx.sql`
    DELETE FROM carecore_message_reactions WHERE message_id = ${messageId} AND user_id = ${ctx.actor.id} AND emoji = ${emoji}
    RETURNING message_id`) as Row[];
  if (removed[0]) return { active: false };
  await ctx.sql`INSERT INTO carecore_message_reactions (message_id, user_id, emoji) VALUES (${messageId}, ${ctx.actor.id}, ${emoji})
    ON CONFLICT DO NOTHING`;
  return { active: true };
}

// Reaktionen je Nachricht, in der festen Reihenfolge der Auswahl.
export async function reactionsFor(ctx: ApiContext, messageIds: string[]) {
  const result = new Map<string, ReactionSummary[]>();
  if (!messageIds.length) return result;
  const rows = (await ctx.sql`
    SELECT r.message_id, r.emoji, COUNT(*)::int AS count, BOOL_OR(r.user_id = ${ctx.actor.id}) AS mine,
      array_agg(u.display_name ORDER BY r.created_at) AS names
    FROM carecore_message_reactions r JOIN carecore_users u ON u.id = r.user_id
    WHERE r.message_id = ANY(${messageIds}::uuid[])
    GROUP BY r.message_id, r.emoji`) as Row[];
  for (const row of rows) {
    const list = result.get(String(row.message_id)) ?? [];
    list.push({
      emoji: row.emoji as MessageReaction,
      count: Number(row.count),
      mine: Boolean(row.mine),
      names: (row.names as string[]) ?? [],
    });
    result.set(String(row.message_id), list);
  }
  for (const list of result.values())
    list.sort((a, b) => MESSAGE_REACTIONS.indexOf(a.emoji) - MESSAGE_REACTIONS.indexOf(b.emoji));
  return result;
}

function parseAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      id: String(item.id),
      name: String(item.name ?? "Datei"),
      mimeType: String(item.mimeType ?? ""),
      sizeBytes: Number(item.sizeBytes ?? 0),
      source: item.source === "shared" ? "shared" : "chat",
      available: true,
    }));
}

function messagePreview(row: Row) {
  if (row.deleted_at) return "Nachricht gelöscht";
  const body = String(row.body ?? "");
  if (body) return preview(body);
  const files = parseAttachments(row.attachments);
  return files.length ? `📎 ${files.map((file) => file.name).join(", ")}` : "";
}

// Übersicht (Chats, Personen) und – falls gewählt – die geöffnete Unterhaltung; die geöffnete gilt als gelesen.
export async function chatPayload(ctx: ApiContext, requestedId: string | null): Promise<ChatPayload> {
  const { sql, actor } = ctx;
  const [conversationRows, memberRows, lastRows, unreadRows, peopleRows, dutyRows] = await Promise.all([
    sql`
      SELECT c.id, c.title, c.kind, c.created_by, c.updated_at, own.pinned, own.muted
      FROM carecore_conversations c
      JOIN carecore_conversation_members own ON own.conversation_id = c.id AND own.user_id = ${actor.id}
      WHERE c.organization_id = ${actor.organizationId}
      ORDER BY c.updated_at DESC` as Promise<Row[]>,
    sql`
      SELECT cm.conversation_id, cm.user_id, cm.last_read_at, u.display_name, COALESCE(p.job_title, '') AS job_title
      FROM carecore_conversation_members cm
      JOIN carecore_conversation_members own ON own.conversation_id = cm.conversation_id AND own.user_id = ${actor.id}
      JOIN carecore_users u ON u.id = cm.user_id
      LEFT JOIN carecore_user_profiles p ON p.user_id = u.id
      ORDER BY u.display_name` as Promise<Row[]>,
    sql`
      SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.body, m.attachments, m.deleted_at, m.created_at,
        u.display_name AS author_name
      FROM carecore_messages m
      JOIN carecore_conversation_members own ON own.conversation_id = m.conversation_id AND own.user_id = ${actor.id}
      LEFT JOIN carecore_users u ON u.id = m.author_user_id
      ORDER BY m.conversation_id, m.created_at DESC` as Promise<Row[]>,
    sql`
      SELECT own.conversation_id, COUNT(m.id)::int AS unread_count,
        BOOL_OR(m.mentions ? ${actor.id}) AS mentioned
      FROM carecore_conversation_members own
      LEFT JOIN carecore_messages m ON m.conversation_id = own.conversation_id AND m.kind = 'text' AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(own.last_read_at, 'epoch'::timestamptz)
        AND m.author_user_id IS DISTINCT FROM ${actor.id}
      WHERE own.user_id = ${actor.id}
      GROUP BY own.conversation_id` as Promise<Row[]>,
    sql`
      SELECT u.id, u.display_name, u.role, COALESCE(p.job_title, '') AS job_title, COALESCE(cu.name, '') AS care_unit_name
      FROM carecore_users u
      JOIN carecore_user_profiles p ON p.user_id = u.id
      LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id
      WHERE p.organization_id = ${actor.organizationId} AND u.active = TRUE AND u.archived_at IS NULL
      ORDER BY u.display_name` as Promise<Row[]>,
    onDutyRows(ctx),
  ]);
  const duty = new Map(onDutyPeople(dutyRows).map((person) => [person.userId, person]));
  const dutyOf = (id: string): { duty: DutyState; dutyDetail: string } => {
    const entry = duty.get(id);
    return { duty: entry?.state ?? null, dutyDetail: entry?.detail ?? "" };
  };
  const membersBy = new Map<string, Row[]>();
  for (const row of memberRows)
    membersBy.set(String(row.conversation_id), [...(membersBy.get(String(row.conversation_id)) ?? []), row]);
  const lastBy = new Map(lastRows.map((row) => [String(row.conversation_id), row]));
  const unreadBy = new Map(unreadRows.map((row) => [String(row.conversation_id), row]));

  const summaries: ChatSummary[] = conversationRows.map((row) => {
    const id = String(row.id);
    const members = membersBy.get(id) ?? [];
    const kind = String(row.kind) as ChatSummary["kind"];
    const others = members.filter((member) => member.user_id !== actor.id);
    const last = lastBy.get(id);
    const unread = unreadBy.get(id);
    return {
      id,
      title:
        kind === "direct"
          ? others.map((member) => String(member.display_name)).join(", ") || "Direktnachricht"
          : String(row.title ?? "Team-Unterhaltung"),
      kind,
      createdBy: row.created_by ? String(row.created_by) : null,
      updatedAt: iso(row.updated_at) ?? "",
      memberIds: members.map((member) => String(member.user_id)),
      memberCount: members.length,
      partnerId: kind === "direct" ? (others[0] ? String(others[0].user_id) : null) : null,
      lastMessage: last
        ? {
            preview: messagePreview(last),
            authorName: (last.author_name as string | null) ?? null,
            createdAt: iso(last.created_at) ?? "",
          }
        : null,
      unreadCount: Number(unread?.unread_count ?? 0),
      mentioned: Boolean(unread?.mentioned),
      pinned: Boolean(row.pinned),
      muted: Boolean(row.muted),
    };
  });
  const people: ChatPerson[] = peopleRows.map((row) => ({
    id: String(row.id),
    name: String(row.display_name),
    role: String(row.role ?? ""),
    jobTitle: String(row.job_title ?? ""),
    careUnit: String(row.care_unit_name ?? ""),
    ...dutyOf(String(row.id)),
  }));
  const selectedId = summaries.some((item) => item.id === requestedId) ? requestedId : null;
  let conversation: ChatConversation | null = null;
  if (selectedId) {
    await sql`UPDATE carecore_conversation_members SET last_read_at = NOW() WHERE conversation_id = ${selectedId} AND user_id = ${actor.id}`;
    const summary = summaries.find((item) => item.id === selectedId)!;
    summary.unreadCount = 0;
    summary.mentioned = false;
    const messageRows = (await sql`
      SELECT m.id, m.kind, m.body, m.created_at, m.edited_at, m.deleted_at, m.author_user_id, m.mentions, m.attachments,
        m.priority, m.pinned_at, m.reply_to_id, COALESCE(u.display_name, 'Unbekannt') AS author_name,
        pb.display_name AS pinned_by_name,
        r.body AS reply_body, r.deleted_at AS reply_deleted, COALESCE(ru.display_name, 'Unbekannt') AS reply_author
      FROM carecore_messages m
      LEFT JOIN carecore_users u ON u.id = m.author_user_id
      LEFT JOIN carecore_users pb ON pb.id = m.pinned_by
      LEFT JOIN carecore_messages r ON r.id = m.reply_to_id
      LEFT JOIN carecore_users ru ON ru.id = r.author_user_id
      WHERE m.conversation_id = ${selectedId}
      ORDER BY m.created_at ASC`) as Row[];
    const reactions = await reactionsFor(
      ctx,
      messageRows.map((row) => String(row.id)),
    );
    // Verknüpfte Dateien können inzwischen gelöscht sein: dann als nicht mehr verfügbar zeigen.
    const attachmentIds = messageRows.flatMap((row) => parseAttachments(row.attachments).map((file) => file.id));
    const availableRows = attachmentIds.length
      ? ((await sql`
          SELECT id FROM carecore_cloud_files WHERE id = ANY(${attachmentIds}::uuid[]) AND deleted_at IS NULL
            AND organization_id = ${actor.organizationId}`) as Row[])
      : [];
    const available = new Set(availableRows.map((row) => String(row.id)));
    const messages: ChatMessage[] = messageRows.map((row) => ({
      id: String(row.id),
      kind: row.kind === "system" ? "system" : "text",
      body: String(row.body ?? ""),
      authorId: row.author_user_id ? String(row.author_user_id) : null,
      authorName: String(row.author_name),
      createdAt: iso(row.created_at) ?? "",
      editedAt: iso(row.edited_at),
      deleted: Boolean(row.deleted_at),
      priority: (String(row.priority) in MESSAGE_PRIORITIES ? String(row.priority) : "normal") as MessagePriority,
      replyTo: row.reply_to_id
        ? {
            id: String(row.reply_to_id),
            authorName: String(row.reply_author),
            body: row.reply_deleted ? "" : preview(String(row.reply_body ?? "")),
            deleted: Boolean(row.reply_deleted),
          }
        : null,
      mentions: Array.isArray(row.mentions) ? (row.mentions as string[]) : [],
      reactions: reactions.get(String(row.id)) ?? [],
      attachments: parseAttachments(row.attachments).map((file) => ({ ...file, available: available.has(file.id) })),
      pinnedAt: iso(row.pinned_at),
      pinnedByName: (row.pinned_by_name as string | null) ?? null,
    }));
    const files: ChatFile[] = [];
    const seen = new Set<string>();
    for (const message of [...messages].reverse())
      for (const file of message.attachments)
        if (!seen.has(file.id) && file.available) {
          seen.add(file.id);
          files.push({ ...file, sharedByName: message.authorName, sharedAt: message.createdAt, messageId: message.id });
        }
    const members: ChatMember[] = (membersBy.get(selectedId) ?? []).map((row) => ({
      userId: String(row.user_id),
      name: String(row.display_name),
      jobTitle: String(row.job_title ?? ""),
      lastReadAt: row.user_id === actor.id ? new Date().toISOString() : iso(row.last_read_at),
      ...dutyOf(String(row.user_id)),
    }));
    conversation = {
      ...summary,
      members,
      messages,
      files,
      canManage: summary.kind !== "direct" && summary.createdBy === actor.id,
    };
  }
  return {
    actor: { id: actor.id, displayName: actor.display_name },
    conversations: summaries,
    people,
    selectedId,
    conversation,
  };
}

// Kurzliste für „Im Messenger teilen“ (Ablage).
export async function conversationList(ctx: ApiContext) {
  const payload = await chatPayload(ctx, null);
  return payload.conversations.map((item) => ({ id: item.id, title: item.title, kind: item.kind }));
}
