import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { changePortalPassword, portalActor } from "@/lib/portal";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await portalActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const body = (await request.json()) as { current?: unknown; next?: unknown };
    await changePortalPassword(carecoreDb(), actor, body.current, body.next);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Das Passwort konnte nicht geändert werden.");
  }
}
