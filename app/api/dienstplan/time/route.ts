import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { timesheet } from "@/lib/roster/time-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return respond(
    async () => timesheet(await rosterContext(), new URL(request.url).searchParams),
    "Die Arbeitszeiten konnten nicht geladen werden.",
  );
}
