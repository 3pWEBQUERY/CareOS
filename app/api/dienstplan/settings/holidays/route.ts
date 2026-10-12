import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { saveHolidays } from "@/lib/roster/settings-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return respond(
    async () => saveHolidays(await rosterContext(), await readBody(request)),
    "Die Feiertage konnten nicht gespeichert werden.",
  );
}
