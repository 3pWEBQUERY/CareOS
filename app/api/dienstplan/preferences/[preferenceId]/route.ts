import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { deletePreference, savePreference } from "@/lib/roster/request-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ preferenceId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return respond(
    async () => savePreference(await rosterContext(), (await params).preferenceId, await readBody(request)),
    "Der Dienstwunsch konnte nicht gespeichert werden.",
  );
}

export async function DELETE(_request: Request, { params }: Context) {
  return respond(
    async () => deletePreference(await rosterContext(), (await params).preferenceId),
    "Der Dienstwunsch konnte nicht gelöscht werden.",
  );
}
