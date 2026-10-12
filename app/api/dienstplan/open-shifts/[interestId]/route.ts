import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { decideInterest, withdrawInterest } from "@/lib/roster/open-shift-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ interestId: string }> };

// { action: "withdraw" } (meldende Person) | { decision: "ASSIGNED" | "DECLINED", comment?, acknowledgedWarnings?, overrideReason? } (Leitung)
export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    const ctx = await rosterContext();
    const { interestId } = await params;
    const body = await readBody(request);
    if (body.action === "withdraw") {
      await withdrawInterest(ctx, interestId);
      return { status: "WITHDRAWN" };
    }
    return decideInterest(ctx, interestId, body);
  }, "Das Interesse konnte nicht bearbeitet werden.");
}
