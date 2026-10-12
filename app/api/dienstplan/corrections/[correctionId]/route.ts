import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { decideCorrection } from "@/lib/roster/time-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ correctionId: string }> };

export async function POST(request: Request, { params }: Context) {
  return respond(
    async () => decideCorrection(await rosterContext(), (await params).correctionId, await readBody(request)),
    "Die Korrektur konnte nicht entschieden werden.",
  );
}
