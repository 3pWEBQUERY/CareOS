import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { deleteStaffing } from "@/lib/roster/settings-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ requirementId: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  return respond(
    async () => deleteStaffing(await rosterContext(), (await params).requirementId),
    "Die Vorgabe konnte nicht gelöscht werden.",
  );
}
