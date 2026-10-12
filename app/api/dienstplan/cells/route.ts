import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { setCells } from "@/lib/roster/shift-service";

export const runtime = "nodejs";

// Mehrere Zellen des Rasters auf einmal setzen oder leeren (PEP-Arbeitsweise).
export async function PUT(request: Request) {
  return respond(
    async () => setCells(await rosterContext(), await readBody(request)),
    "Die Dienste konnten nicht gespeichert werden.",
  );
}
