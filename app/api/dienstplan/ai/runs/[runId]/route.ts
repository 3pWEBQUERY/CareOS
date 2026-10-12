import { getRun } from "@/lib/roster/ai";
import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";

export const runtime = "nodejs";
type Context = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, { params }: Context) {
  return respond(
    async () => getRun(await rosterContext(), (await params).runId),
    "Der KI-Lauf konnte nicht geladen werden.",
  );
}
