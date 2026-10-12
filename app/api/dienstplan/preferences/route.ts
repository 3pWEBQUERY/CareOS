import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { savePreference } from "@/lib/roster/request-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return respond(
    async () => savePreference(await rosterContext(), null, await readBody(request)),
    "Der Dienstwunsch konnte nicht gespeichert werden.",
    201,
  );
}
