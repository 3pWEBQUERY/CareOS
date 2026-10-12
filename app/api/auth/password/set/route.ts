import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { completePasswordLink, describePasswordLink } from "@/lib/password-links";

export const runtime = "nodejs";

// Link prüfen (für die Seite „Passwort setzen“).
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const link = await describePasswordLink(token);
    return NextResponse.json(link ? { valid: true, ...link } : { valid: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "Der Link konnte nicht geprüft werden.");
  }
}

// Neues Passwort mit dem Link setzen; danach mit dem neuen Passwort anmelden.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: unknown; password?: unknown };
    return NextResponse.json(
      await completePasswordLink(
        typeof body.token === "string" ? body.token : "",
        typeof body.password === "string" ? body.password : "",
      ),
    );
  } catch (error) {
    return apiErrorResponse(error, "Das Passwort konnte nicht gesetzt werden.");
  }
}
