import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { createTimeOff } from "@/lib/roster/request-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return respond(
    async () => createTimeOff(await rosterContext(), await readBody(request)),
    "Wunschfrei konnte nicht beantragt werden.",
    201,
  );
}
