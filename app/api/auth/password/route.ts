import { NextResponse } from "next/server";
import { clientIp } from "@/lib/login-session";
import { mailConfigured } from "@/lib/mail";
import { requestPasswordReset } from "@/lib/password-links";
import { consumeWrite, rateLimitKey } from "@/lib/rate-limit";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Höchstens so viele Anfragen „Passwort vergessen“ je IP-Adresse und Minute.
const REQUESTS_PER_MINUTE = 5;
const SENT =
  "Wenn ein Konto mit hinterlegter E-Mail-Adresse existiert, ist ein Link unterwegs. Bitte das Postfach prüfen.";

// Ist „Passwort vergessen“ verfügbar? Nur mit eingerichtetem E-Mail-Versand.
export async function GET() {
  return NextResponse.json({ enabled: mailConfigured() }, { headers: { "Cache-Control": "no-store" } });
}

// Link anfordern: Antwort immer gleich, damit sich nicht erraten lässt, welche Konten es gibt.
export async function POST(request: Request) {
  try {
    if (!mailConfigured())
      return NextResponse.json({ error: "Der E-Mail-Versand ist nicht eingerichtet." }, { status: 409 });
    const limit = await consumeWrite(
      carecoreDb(),
      `pw:${rateLimitKey(undefined, clientIp(request))}`,
      REQUESTS_PER_MINUTE,
    );
    if (!limit.allowed)
      return NextResponse.json(
        { error: "Zu viele Anfragen. Bitte einen Moment warten und erneut versuchen." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    const body = (await request.json().catch(() => ({}))) as { identifier?: unknown };
    const identifier = typeof body.identifier === "string" ? body.identifier : "";
    if (!identifier.trim())
      return NextResponse.json({ error: "Bitte Benutzername oder E-Mail-Adresse eingeben." }, { status: 400 });
    try {
      await requestPasswordReset(identifier);
    } catch (error) {
      // Auch ein Versandfehler ändert die Antwort nicht; er steht im Server-Log.
      console.error("Password reset mail failed", error);
    }
    return NextResponse.json({ ok: true, message: SENT });
  } catch (error) {
    console.error("Password reset request failed", error);
    return NextResponse.json({ error: "Die Anfrage ist derzeit nicht möglich." }, { status: 500 });
  }
}
