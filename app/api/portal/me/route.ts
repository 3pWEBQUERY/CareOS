import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { portalActor, portalResidents } from "@/lib/portal";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Angemeldete Portal-Person mit den freigegebenen Personen (ohne Daten; die gibt es je Person).
export async function GET() {
  try {
    const actor = await portalActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const account = { displayName: actor.displayName, kind: actor.kind, mustChangePassword: actor.mustChangePassword };
    if (actor.mustChangePassword) return NextResponse.json({ account, residents: [] });
    return NextResponse.json(
      { account, residents: await portalResidents(carecoreDb(), actor) },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "Das Portal konnte nicht geladen werden.");
  }
}
