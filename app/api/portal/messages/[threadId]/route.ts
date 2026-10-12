import { portalThread } from "@/lib/portal-messages";
import { withPortal } from "../../portal-route";

export const runtime = "nodejs";

export const GET = async (_request: Request, { params }: { params: Promise<{ threadId: string }> }) => {
  const { threadId } = await params;
  return withPortal("Die Unterhaltung konnte nicht geladen werden.", async (sql, actor) =>
    portalThread(sql, actor, threadId),
  );
};
