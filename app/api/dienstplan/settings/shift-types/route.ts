import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { saveShiftType } from "@/lib/roster/settings-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return respond(
    async () => saveShiftType(await rosterContext(), null, await readBody(request)),
    "Der Diensttyp konnte nicht gespeichert werden.",
    201,
  );
}
