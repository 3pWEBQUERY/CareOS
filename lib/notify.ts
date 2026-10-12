import { randomUUID } from "node:crypto";
import type { ApiContext } from "@/lib/api-context";

// Benachrichtigung an eine andere Person als nicht ausgeführte Abfrage für `ctx.sql.transaction([...])` (leer für die eigene Person).
export function notifyStatements(
  ctx: ApiContext,
  userIds: Array<string | null | undefined>,
  title: string,
  body: string,
  type: string,
  link: string,
  priority = "normal",
) {
  return [...new Set(userIds)]
    .filter((userId): userId is string => !!userId && userId !== ctx.actor.id)
    .map(
      (userId) => ctx.sql`
        INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
        VALUES (${randomUUID()}, ${userId}, ${title}, ${body}, ${type}, ${priority}, ${link})`,
    );
}
