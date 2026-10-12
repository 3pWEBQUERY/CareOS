import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { deleteWageType } from "@/lib/roster/settings-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ wageTypeId: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  return respond(
    async () => deleteWageType(await rosterContext(), (await params).wageTypeId),
    "Die Lohnart konnte nicht gelöscht werden.",
  );
}
