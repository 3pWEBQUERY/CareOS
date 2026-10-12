import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { portalActor, type PortalActor } from "@/lib/portal";
import { carecoreDb } from "@/lib/server-data";

// Gemeinsamer Rahmen der Portal-Schnittstellen: angemeldeter Portal-Zugang mit geändertem Einmal-Passwort.
export async function withPortal(
  fallback: string,
  run: (sql: ReturnType<typeof carecoreDb>, actor: PortalActor) => Promise<unknown>,
) {
  try {
    const actor = await portalActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (actor.mustChangePassword)
      return NextResponse.json({ error: "Bitte zuerst das Passwort ändern." }, { status: 403 });
    const result = await run(carecoreDb(), actor);
    return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return apiErrorResponse(error, fallback);
  }
}
