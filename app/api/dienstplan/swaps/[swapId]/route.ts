import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { decideSwap, respondToSwap } from "@/lib/roster/swap-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ swapId: string }> };

// accept / decline (Ziel), withdraw (antragstellende Person), approve / reject (Leitung).
export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    const ctx = await rosterContext();
    const { swapId } = await params;
    const body = await readBody(request);
    if (body.action === "accept" || body.action === "decline")
      return respondToSwap(ctx, swapId, { accept: body.action === "accept" });
    return decideSwap(ctx, swapId, body);
  }, "Der Tausch konnte nicht bearbeitet werden.");
}
