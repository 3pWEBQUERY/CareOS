import { listAudit } from "@/lib/roster/audit-service";
import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return respond(
    async () => listAudit(await rosterContext(), new URL(request.url).searchParams),
    "Das Protokoll konnte nicht geladen werden.",
  );
}
