import { NextResponse } from "next/server";
import { apiErrorResponse, assertUuid } from "@/lib/api-context";
import { portalActor, portalResidentDetail } from "@/lib/portal";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

// Daten einer Person, nur die freigegebenen Bereiche; jeder Abruf wird protokolliert.
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await portalActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (actor.mustChangePassword)
      return NextResponse.json({ error: "Bitte zuerst das Passwort ändern." }, { status: 403 });
    const residentId = assertUuid((await params).residentId, "Person");
    return NextResponse.json(await portalResidentDetail(carecoreDb(), actor, residentId), {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    return apiErrorResponse(error, "Die Daten konnten nicht geladen werden.");
  }
}
