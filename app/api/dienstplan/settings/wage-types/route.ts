import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { saveWageType } from "@/lib/roster/settings-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return respond(
    async () => saveWageType(await rosterContext(), await readBody(request)),
    "Die Lohnart konnte nicht gespeichert werden.",
  );
}
