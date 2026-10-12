import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { changeShift } from "@/lib/roster/shift-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ shiftId: string }> };

// Ändern, Verschieben, Tauschen oder Löschen (body.action).
export async function PATCH(request: Request, { params }: Context) {
  return respond(
    async () => changeShift(await rosterContext(), (await params).shiftId, await readBody(request)),
    "Der Dienst konnte nicht geändert werden.",
  );
}
