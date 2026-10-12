import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { isLoginThrottled, recordFailedLogin } from "@/lib/auth";
import { carecoreActor } from "@/lib/server-data";
import { changePassword } from "@/lib/user-settings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    // Wrong current passwords count like failed sign-ins, so guessing is throttled.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (await isLoginThrottled(actor.username, ip))
      return NextResponse.json({ error: "Zu viele Versuche. Bitte später erneut versuchen." }, { status: 429 });
    try {
      await changePassword(actor, (await request.json()) as Record<string, unknown>);
    } catch (error) {
      if ((error as { status?: number }).status === 403) await recordFailedLogin(actor.username, ip);
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Passwort konnte nicht geändert werden.");
  }
}
