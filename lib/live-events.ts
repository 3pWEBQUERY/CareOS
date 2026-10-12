import type { ApiContext, Row } from "@/lib/api-context";

// Echtzeit (Server-Sent Events): kleine Kennwerte je Kanal. Ändert sich ein Kennwert, lädt der Client den Bereich neu.
// - notifications: eigene Benachrichtigungen (neu, gelesen)
// - messages: Nachrichten in eigenen Unterhaltungen (neu, bearbeitet, gelöscht, angeheftet, Reaktionen, gelesen)
// - work: Aufgaben und Übergaben der Organisation (für die Zähler der Navigation)
export const LIVE_CHANNELS = ["notifications", "messages", "work"] as const;
export type LiveChannel = (typeof LIVE_CHANNELS)[number];
export type LiveSnapshot = Record<LiveChannel, string>;

export async function liveSnapshot(ctx: ApiContext): Promise<LiveSnapshot> {
  const rows = (await ctx.sql`
    SELECT
      (SELECT CONCAT(COUNT(*) FILTER (WHERE read_at IS NULL), '|', MAX(created_at), '|', MAX(read_at))
        FROM carecore_notifications WHERE user_id = ${ctx.actor.id}) AS notifications,
      (SELECT CONCAT(MAX(GREATEST(m.created_at, COALESCE(m.edited_at, m.created_at), COALESCE(m.deleted_at, m.created_at),
            COALESCE(m.pinned_at, m.created_at))), '|', COUNT(m.id), '|', COUNT(m.pinned_at), '|',
          (SELECT COUNT(*) FROM carecore_message_reactions r JOIN carecore_messages rm ON rm.id = r.message_id
            JOIN carecore_conversation_members rc ON rc.conversation_id = rm.conversation_id AND rc.user_id = ${ctx.actor.id}), '|',
          (SELECT MAX(last_read_at) FROM carecore_conversation_members WHERE user_id = ${ctx.actor.id}))
        FROM carecore_conversation_members cm JOIN carecore_messages m ON m.conversation_id = cm.conversation_id
        WHERE cm.user_id = ${ctx.actor.id}) AS messages,
      (SELECT CONCAT(
          (SELECT MAX(updated_at) FROM carecore_tasks WHERE organization_id = ${ctx.actor.organizationId}), '|',
          (SELECT COUNT(*) FROM carecore_tasks WHERE organization_id = ${ctx.actor.organizationId}), '|',
          (SELECT MAX(created_at) FROM carecore_handovers WHERE organization_id = ${ctx.actor.organizationId}), '|',
          (SELECT MAX(read_at) FROM carecore_handover_reads WHERE user_id = ${ctx.actor.id}))) AS work`) as Row[];
  const row = rows[0] ?? {};
  return {
    notifications: String(row.notifications ?? ""),
    messages: String(row.messages ?? ""),
    work: String(row.work ?? ""),
  };
}

// Stand als Event-ID (kompakt, ohne Inhalte), damit eine neue Verbindung Änderungen seit der letzten erkennt.
export const encodeSnapshot = (snapshot: LiveSnapshot) => Buffer.from(JSON.stringify(snapshot)).toString("base64url");

export function decodeSnapshot(value: string | null): LiveSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    return LIVE_CHANNELS.every((channel) => typeof parsed[channel] === "string") ? (parsed as LiveSnapshot) : null;
  } catch {
    return null;
  }
}

export const changedChannels = (before: LiveSnapshot | null, after: LiveSnapshot) =>
  before ? LIVE_CHANNELS.filter((channel) => before[channel] !== after[channel]) : [];
