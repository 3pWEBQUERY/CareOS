import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { optionalUuid } from "@/lib/roster/schemas";
import { getSettings } from "@/lib/roster/settings-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return respond(async () => {
    const unitId = optionalUuid(new URL(request.url).searchParams.get("einheit"), "Wohnbereich");
    return getSettings(await rosterContext(), unitId);
  }, "Die Einstellungen konnten nicht geladen werden.");
}
