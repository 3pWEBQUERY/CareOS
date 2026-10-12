import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { createSwap } from "@/lib/roster/swap-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return respond(
    async () => createSwap(await rosterContext(), await readBody(request)),
    "Die Tauschanfrage konnte nicht gesendet werden.",
    201,
  );
}
