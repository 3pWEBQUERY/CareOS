import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { decideTimeOff, withdrawTimeOff } from "@/lib/roster/request-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ requestId: string }> };

// Zurückziehen (antragstellende Person) oder entscheiden (Leitung).
export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    const ctx = await rosterContext();
    const { requestId } = await params;
    const body = await readBody(request);
    return body.action === "withdraw" ? withdrawTimeOff(ctx, requestId) : decideTimeOff(ctx, requestId, body);
  }, "Der Antrag konnte nicht bearbeitet werden.");
}
