import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { endManagedUserSessions } from "@/lib/admin-users";
import { carecoreActor, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

// Administration: alle Sitzungen einer Person beenden (z. B. verlorenes Gerät), protokolliert.
export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor || !hasPermission(actor, "administration.manage"))
      return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    const body = (await request.json()) as { userId?: unknown };
    if (typeof body.userId !== "string") return NextResponse.json({ error: "Benutzer fehlt." }, { status: 400 });
    return NextResponse.json(await endManagedUserSessions(actor, body.userId));
  } catch (error) {
    if (error instanceof Error && error.message === "CANNOT_END_OWN_SESSIONS")
      return NextResponse.json(
        { error: "Die eigenen Sitzungen beendest du unter Einstellungen › Sicherheit." },
        { status: 400 },
      );
    if (error instanceof Error && error.message === "USER_NOT_FOUND")
      return NextResponse.json({ error: "Mitarbeiter ist in dieser Organisation nicht verfügbar." }, { status: 404 });
    return apiErrorResponse(error, "Die Sitzungen konnten nicht beendet werden.");
  }
}
