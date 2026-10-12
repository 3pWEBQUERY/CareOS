import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { saveRuleSet } from "@/lib/roster/settings-service";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  return respond(
    async () => saveRuleSet(await rosterContext(), await readBody(request)),
    "Das Regelwerk konnte nicht gespeichert werden.",
  );
}
