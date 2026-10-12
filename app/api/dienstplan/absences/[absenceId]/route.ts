import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { decideAbsence } from "@/lib/roster/request-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ absenceId: string }> };

export async function POST(request: Request, { params }: Context) {
  return respond(
    async () => decideAbsence(await rosterContext(), (await params).absenceId, await readBody(request)),
    "Die Abwesenheit konnte nicht bearbeitet werden.",
  );
}
