import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { updateTimeEntry } from "@/lib/roster/time-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ entryId: string }> };

// Direkte Korrektur durch die Leitung (mit Begründung).
export async function PATCH(request: Request, { params }: Context) {
  return respond(
    async () => updateTimeEntry(await rosterContext(), (await params).entryId, await readBody(request)),
    "Der Zeiteintrag konnte nicht korrigiert werden.",
  );
}
