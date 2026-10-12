import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { createShift } from "@/lib/roster/shift-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return respond(
    async () => createShift(await rosterContext(), await readBody(request)),
    "Der Dienst konnte nicht gespeichert werden.",
    201,
  );
}
