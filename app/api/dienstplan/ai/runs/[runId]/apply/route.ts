import { applyRun } from "@/lib/roster/ai";
import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ runId: string }> };

export async function POST(request: Request, { params }: Context) {
  return respond(
    async () => applyRun(await rosterContext(), (await params).runId, await readBody(request)),
    "Der KI-Vorschlag konnte nicht übernommen werden.",
  );
}
