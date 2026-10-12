import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { registerInterest } from "@/lib/roster/open-shift-service";

export const runtime = "nodejs";

// Interesse an einem offenen Dienst melden: { unitId, shiftTypeId, date, message? }.
export async function POST(request: Request) {
  return respond(
    async () => registerInterest(await rosterContext(), await readBody(request)),
    "Das Interesse konnte nicht gemeldet werden.",
    201,
  );
}
