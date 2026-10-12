import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { periodAction } from "@/lib/roster/period-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ periodId: string }> };

// Veröffentlichen, zum Entwurf zurücksetzen, Monat abschliessen oder wieder öffnen (body.action).
export async function POST(request: Request, { params }: Context) {
  return respond(
    async () => periodAction(await rosterContext(), (await params).periodId, await readBody(request)),
    "Der Dienstplan konnte nicht geändert werden.",
  );
}
