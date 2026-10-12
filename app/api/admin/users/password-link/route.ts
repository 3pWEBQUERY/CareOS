import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { sendPasswordLink } from "@/lib/password-links";
import { carecoreActor, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

// Administration: Link zum Setzen des Passworts an die hinterlegte E-Mail-Adresse senden.
export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor || !hasPermission(actor, "administration.manage"))
      return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    const body = (await request.json()) as { userId?: unknown };
    if (typeof body.userId !== "string") return NextResponse.json({ error: "Benutzer fehlt." }, { status: 400 });
    return NextResponse.json(await sendPasswordLink(actor, body.userId));
  } catch (error) {
    return apiErrorResponse(error, "Der Link konnte nicht gesendet werden.");
  }
}
