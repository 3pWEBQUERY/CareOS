import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor } from "@/lib/server-data";
import { endSessions } from "@/lib/user-settings";

export const runtime = "nodejs";

// DELETE ?id=… ends one other session, without id all other sessions.
export async function DELETE(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const id = new URL(request.url).searchParams.get("id");
    if (id && !/^[0-9a-f-]{36}$/i.test(id))
      return NextResponse.json({ error: "Sitzung ist ungültig." }, { status: 400 });
    return NextResponse.json({ ended: await endSessions(actor, id) });
  } catch (error) {
    return apiErrorResponse(error, "Sitzung konnte nicht beendet werden.");
  }
}
