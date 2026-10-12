import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { getSchedule } from "@/lib/roster/schedule";
import { month, optionalUuid } from "@/lib/roster/schemas";
import { localDate } from "@/lib/roster/time";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return respond(async () => {
    const ctx = await rosterContext();
    const params = new URL(request.url).searchParams;
    const selected = params.get("monat")
      ? month(params.get("monat"))
      : month(localDate(new Date(), "Europe/Zurich").slice(0, 7));
    return getSchedule(ctx, {
      unitId: optionalUuid(params.get("einheit"), "Wohnbereich"),
      ...selected,
      team: params.get("ansicht") === "team",
    });
  }, "Der Dienstplan konnte nicht geladen werden.");
}
