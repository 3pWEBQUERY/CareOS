import { portalSend, portalThreads } from "@/lib/portal-messages";
import { withPortal } from "../portal-route";

export const runtime = "nodejs";

export const GET = () =>
  withPortal("Nachrichten konnten nicht geladen werden.", async (sql, actor) => ({
    threads: await portalThreads(sql, actor),
  }));

export const POST = async (request: Request) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return withPortal("Die Nachricht konnte nicht gesendet werden.", async (sql, actor) => ({
    threadId: await portalSend(sql, actor, body),
  }));
};
