import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { getWorkContext, updateWorkContext } from "@/lib/work-context";

export const runtime = "nodejs";

async function currentUser() {
  const cookieStore = await cookies();
  return getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
}

function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "DATABASE_URL_NOT_CONFIGURED")
    return NextResponse.json({ error: "Datenbank ist nicht konfiguriert." }, { status: 503 });
  if (error instanceof Error && error.message === "CARE_UNIT_NOT_FOUND")
    return NextResponse.json({ error: "Der gewählte Wohnbereich ist nicht verfügbar." }, { status: 400 });
  console.error("Work context request failed", error);
  return NextResponse.json({ error: "Arbeitsbereich konnte nicht geladen werden." }, { status: 500 });
}

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    return NextResponse.json(await getWorkContext(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const body = (await request.json()) as { primaryCareUnitId?: unknown; jobTitle?: unknown; phone?: unknown };
    const data = {
      primaryCareUnitId: typeof body.primaryCareUnitId === "string" ? body.primaryCareUnitId : undefined,
      jobTitle: typeof body.jobTitle === "string" ? body.jobTitle.trim().slice(0, 140) : undefined,
      phone: typeof body.phone === "string" ? body.phone.trim().slice(0, 60) : undefined,
    };
    if (!data.primaryCareUnitId && data.jobTitle === undefined && data.phone === undefined)
      return NextResponse.json({ error: "Keine gültige Änderung übermittelt." }, { status: 400 });
    return NextResponse.json(await updateWorkContext(user.id, data));
  } catch (error) {
    return errorResponse(error);
  }
}
