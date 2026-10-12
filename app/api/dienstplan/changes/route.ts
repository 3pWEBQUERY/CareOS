import { rosterContext } from "@/lib/roster/context";
import { notFound, respond } from "@/lib/roster/errors";
import { visibleUnitIds } from "@/lib/roster/permissions";
import { changeToken } from "@/lib/roster/schedule";
import { month, uuid } from "@/lib/roster/schemas";

export const runtime = "nodejs";

// Leichte Abfrage für das Polling: nur ein Vergleichswert, ob sich der Plan geändert hat.
export async function GET(request: Request) {
  return respond(async () => {
    const ctx = await rosterContext();
    const params = new URL(request.url).searchParams;
    const unitId = uuid(params.get("einheit"), "Wohnbereich");
    if (!visibleUnitIds(ctx.access).includes(unitId)) throw notFound("Wohnbereich");
    const selected = month(params.get("monat"));
    return { token: await changeToken(ctx, unitId, selected.year, selected.month) };
  }, "Änderungen konnten nicht geprüft werden.");
}
