import { NextResponse } from "next/server";
import { authenticate, clearFailedLogins, isLoginThrottled, recordFailedLogin } from "@/lib/auth";
import { clientIp, sessionResponse } from "@/lib/login-session";
import { createChallenge, isMfaEnabled } from "@/lib/mfa";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password || username.length > 80 || password.length > 200) {
      return NextResponse.json({ error: "Bitte Benutzername und Passwort vollständig eingeben." }, { status: 400 });
    }
    const ip = clientIp(request);
    if (await isLoginThrottled(username, ip)) {
      return NextResponse.json(
        { error: "Zu viele fehlgeschlagene Anmeldeversuche. Bitte in 15 Minuten erneut versuchen." },
        { status: 429, headers: { "Retry-After": "900" } },
      );
    }
    const user = await authenticate(username, password);
    if (!user) {
      await recordFailedLogin(username, ip);
      return NextResponse.json({ error: "Benutzername oder Passwort ist nicht korrekt." }, { status: 401 });
    }
    // Mit Zwei-Faktor-Anmeldung entsteht die Sitzung erst nach dem Code (POST /api/auth/mfa).
    const sql = carecoreDb();
    if (await isMfaEnabled(sql, user.id))
      return NextResponse.json({
        mfaRequired: true,
        challenge: await createChallenge(sql, user.id, request.headers.get("user-agent")),
      });
    await clearFailedLogins(username);
    return sessionResponse(user, request.headers.get("user-agent"));
  } catch (error) {
    if (error instanceof Error && error.message === "DATABASE_URL_NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "Neon Postgres ist noch nicht verbunden. DATABASE_URL fehlt." },
        { status: 503 },
      );
    }
    console.error("Login failed", error);
    return NextResponse.json({ error: "Die Anmeldung ist derzeit nicht verfügbar." }, { status: 500 });
  }
}
