import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";
import { saveEmployeeProfile } from "@/lib/roster/settings-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ userId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return respond(
    async () => saveEmployeeProfile(await rosterContext(), (await params).userId, await readBody(request)),
    "Das Personalprofil konnte nicht gespeichert werden.",
  );
}
