import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { confirmEnrollment, disableMfa, mfaStatus, regenerateRecoveryCodes, startEnrollment } from "@/lib/mfa";
import { carecoreActor, carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    return NextResponse.json(await mfaStatus(carecoreDb(), actor.id));
  } catch (error) {
    return apiErrorResponse(error, "Die Zwei-Faktor-Anmeldung konnte nicht geladen werden.");
  }
}

// { action: "start" } | { action: "confirm", code } | { action: "disable", code } | { action: "recovery", code }
export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const body = (await request.json()) as { action?: unknown; code?: unknown };
    const sql = carecoreDb();
    if (body.action === "start") return NextResponse.json(await startEnrollment(sql, actor));
    if (body.action === "confirm") return NextResponse.json(await confirmEnrollment(sql, actor, body.code));
    if (body.action === "recovery") return NextResponse.json(await regenerateRecoveryCodes(sql, actor, body.code));
    if (body.action === "disable") {
      await disableMfa(sql, actor, body.code);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, "Die Zwei-Faktor-Anmeldung konnte nicht geändert werden.");
  }
}
