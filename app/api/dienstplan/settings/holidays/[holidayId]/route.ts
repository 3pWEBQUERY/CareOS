import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { deleteHoliday } from "@/lib/roster/settings-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ holidayId: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  return respond(
    async () => deleteHoliday(await rosterContext(), (await params).holidayId),
    "Der Feiertag konnte nicht gelöscht werden.",
  );
}
