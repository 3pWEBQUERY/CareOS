import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { deleteShiftType, saveShiftType } from "@/lib/roster/settings-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ typeId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return respond(
    async () => saveShiftType(await rosterContext(), (await params).typeId, await readBody(request)),
    "Der Diensttyp konnte nicht gespeichert werden.",
  );
}

export async function DELETE(_request: Request, { params }: Context) {
  return respond(
    async () => deleteShiftType(await rosterContext(), (await params).typeId),
    "Der Diensttyp konnte nicht gelöscht werden.",
  );
}
