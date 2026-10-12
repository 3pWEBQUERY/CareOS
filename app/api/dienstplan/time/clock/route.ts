import { rosterContext } from "@/lib/roster/context";
import { invalid, respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { clockIn, clockOut, toggleBreak } from "@/lib/roster/time-service";

export const runtime = "nodejs";

// Ein-/Ausstempeln und Pause; die Zeit setzt immer der Server.
export async function POST(request: Request) {
  return respond(async () => {
    const ctx = await rosterContext();
    const body = await readBody(request);
    if (body.action === "in") return clockIn(ctx, body);
    if (body.action === "out") return clockOut(ctx, body);
    if (body.action === "break-start") return toggleBreak(ctx, "start");
    if (body.action === "break-end") return toggleBreak(ctx, "end");
    throw invalid("Unbekannte Aktion.");
  }, "Die Zeiterfassung ist fehlgeschlagen.");
}
