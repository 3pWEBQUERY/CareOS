import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { createAbsence } from "@/lib/roster/request-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return respond(
    async () => createAbsence(await rosterContext(), await readBody(request)),
    "Die Abwesenheit konnte nicht gemeldet werden.",
    201,
  );
}
