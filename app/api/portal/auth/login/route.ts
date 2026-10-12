import { NextResponse } from "next/server";
import { clearFailedLogins, isLoginThrottled, recordFailedLogin } from "@/lib/auth";
import { clientIp } from "@/lib/login-session";
import { PORTAL_COOKIE, authenticatePortal, createPortalSession } from "@/lib/portal";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Anmeldung im Portal (Angehörige, Ärztinnen/Ärzte); gedrosselt wie die Anmeldung der Mitarbeitenden.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password || username.length > 80 || password.length > 200)
      return NextResponse.json({ error: "Bitte Benutzername und Passwort vollständig eingeben." }, { status: 400 });
    const key = `portal:${username}`;
    const ip = clientIp(request);
    if (await isLoginThrottled(key, ip))
      return NextResponse.json(
        { error: "Zu viele fehlgeschlagene Anmeldeversuche. Bitte in 15 Minuten erneut versuchen." },
        { status: 429, headers: { "Retry-After": "900" } },
      );
    const sql = carecoreDb();
    const accountId = await authenticatePortal(sql, username, password);
    if (!accountId) {
      await recordFailedLogin(key, ip);
      return NextResponse.json({ error: "Benutzername oder Passwort ist nicht korrekt." }, { status: 401 });
    }
    await clearFailedLogins(key);
    const session = await createPortalSession(sql, accountId, request.headers.get("user-agent"));
    const response = NextResponse.json({ ok: true });
    response.cookies.set(PORTAL_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    console.error("Portal login failed", error);
    return NextResponse.json({ error: "Die Anmeldung ist derzeit nicht verfügbar." }, { status: 500 });
  }
}
