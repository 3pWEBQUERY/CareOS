import { NextResponse } from "next/server";
import type { Row } from "@/lib/api-context";
import { clearFailedLogins, isLoginThrottled, recordFailedLogin } from "@/lib/auth";
import { clientIp, sessionResponse } from "@/lib/login-session";
import { challengeUsername, completeChallenge } from "@/lib/mfa";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Anmeldung, zweite Stufe: { challenge, code } – Code aus der Authenticator-App oder ein Wiederherstellungscode.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { challenge?: unknown; code?: unknown };
    const sql = carecoreDb();
    const ip = clientIp(request);
    // Gesperrt nach zu vielen Fehlversuchen – auch über mehrere offene Anfragen hinweg.
    const pendingUser = await challengeUsername(sql, body.challenge);
    if (pendingUser && (await isLoginThrottled(pendingUser, ip)))
      return NextResponse.json(
        { error: "Zu viele fehlgeschlagene Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.", restart: true },
        { status: 429, headers: { "Retry-After": "900" } },
      );
    const result = await completeChallenge(sql, body.challenge, body.code);
    if (!result.ok && result.expired)
      return NextResponse.json(
        { error: "Die Anmeldung ist abgelaufen. Bitte erneut mit Benutzername und Passwort anmelden.", restart: true },
        { status: 401 },
      );
    const rows = (await sql`
      SELECT id, username, display_name, role FROM carecore_users WHERE id = ${result.userId} AND active`) as Row[];
    const user = rows[0];
    if (!user) return NextResponse.json({ error: "Die Anmeldung ist nicht möglich.", restart: true }, { status: 401 });
    const username = String(user.username);
    if (!result.ok) {
      await recordFailedLogin(username, ip);
      if (await isLoginThrottled(username, ip))
        return NextResponse.json(
          { error: "Zu viele fehlgeschlagene Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.", restart: true },
          { status: 429, headers: { "Retry-After": "900" } },
        );
      return NextResponse.json({ error: "Der Code stimmt nicht." }, { status: 401 });
    }
    await clearFailedLogins(username);
    return sessionResponse(
      {
        id: String(user.id),
        username,
        display_name: String(user.display_name),
        role: String(user.role),
      },
      result.userAgent ?? request.headers.get("user-agent"),
    );
  } catch (error) {
    console.error("MFA login failed", error);
    return NextResponse.json({ error: "Die Anmeldung ist derzeit nicht verfügbar." }, { status: 500 });
  }
}
