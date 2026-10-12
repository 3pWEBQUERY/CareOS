import { portalAnswerVisit } from "@/lib/portal-visits";
import { withPortal } from "../../portal-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ entryId: string }> };

// Rückmeldung der Ärztin bzw. des Arztes zu einer offenen Frage der Pflege (Freigabe „Visite“).
export const POST = async (request: Request, { params }: Context) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { entryId } = await params;
  return withPortal("Die Rückmeldung konnte nicht gespeichert werden.", (sql, actor) =>
    portalAnswerVisit(sql, actor, entryId, body),
  );
};
