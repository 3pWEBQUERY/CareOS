import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { sessionResponse } from "@/lib/login-session";
import { finishLogin, relyingParty, startLogin } from "@/lib/passkeys";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Anmeldung mit Passkey: { action: "start" } → Optionen | { action: "finish", token, response } → Sitzung.
// Der Passkey verlangt die Bestätigung am Gerät und ersetzt deshalb Passwort und Code.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: unknown; token?: unknown; response?: unknown };
    const sql = carecoreDb();
    const rp = relyingParty(request);
    if (body.action === "start") return NextResponse.json(await startLogin(sql, rp));
    if (body.action !== "finish") return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
    const result = await finishLogin(sql, rp, body);
    if (!result.ok)
      return NextResponse.json(
        {
          error: result.expired
            ? "Die Anmeldung ist abgelaufen. Bitte erneut versuchen."
            : "Dieser Passkey ist bei CareOS nicht (mehr) gültig.",
        },
        { status: 401 },
      );
    return sessionResponse(result.user, request.headers.get("user-agent"));
  } catch (error) {
    return apiErrorResponse(error, "Die Anmeldung mit Passkey ist derzeit nicht möglich.");
  }
}
