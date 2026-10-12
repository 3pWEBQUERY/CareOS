import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { requestCorrection } from "@/lib/roster/time-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ entryId: string }> };

export async function POST(request: Request, { params }: Context) {
  return respond(
    async () => requestCorrection(await rosterContext(), (await params).entryId, await readBody(request)),
    "Die Korrektur konnte nicht beantragt werden.",
    201,
  );
}
