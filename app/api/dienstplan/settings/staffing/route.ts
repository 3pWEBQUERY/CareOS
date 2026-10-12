import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { saveStaffing } from "@/lib/roster/settings-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return respond(
    async () => saveStaffing(await rosterContext(), await readBody(request)),
    "Die Mindestbesetzung konnte nicht gespeichert werden.",
  );
}
