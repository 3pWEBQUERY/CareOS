import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { finishRegistration, listPasskeys, relyingParty, removePasskey, startRegistration } from "@/lib/passkeys";
import { carecoreActor, carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Eigene Passkeys (Einstellungen › Sicherheit).
export async function GET() {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    return NextResponse.json({ passkeys: await listPasskeys(carecoreDb(), actor.id) });
  } catch (error) {
    return apiErrorResponse(error, "Passkeys konnten nicht geladen werden.");
  }
}

// { action: "start" } → Optionen für den Browser | { action: "finish", token, response, name }
export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const body = (await request.json()) as { action?: unknown; token?: unknown; response?: unknown; name?: unknown };
    const sql = carecoreDb();
    const rp = relyingParty(request);
    if (body.action === "start") return NextResponse.json(await startRegistration(sql, actor, rp));
    if (body.action === "finish") return NextResponse.json(await finishRegistration(sql, actor, rp, body));
    return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, "Der Passkey konnte nicht gespeichert werden.");
  }
}

// { passkeyId }
export async function DELETE(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const body = (await request.json()) as { passkeyId?: unknown };
    await removePasskey(carecoreDb(), actor, body.passkeyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Der Passkey konnte nicht entfernt werden.");
  }
}
