import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor } from "@/lib/server-data";
import { endAllPush, resetPreferences, savePreferences, userSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    return NextResponse.json(await userSettings(actor));
  } catch (error) {
    return apiErrorResponse(error, "Einstellungen konnten nicht geladen werden.");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const preferences = await savePreferences(actor, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ preferences });
  } catch (error) {
    return apiErrorResponse(error, "Einstellung konnte nicht gespeichert werden.");
  }
}

// DELETE ?scope=preferences setzt die persönlichen Einstellungen zurück, ?scope=push beendet Push auf allen Geräten.
export async function DELETE(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope === "preferences") return NextResponse.json({ preferences: await resetPreferences(actor) });
    if (scope === "push") return NextResponse.json({ ended: await endAllPush(actor) });
    return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, "Die Aktion konnte nicht ausgeführt werden.");
  }
}
