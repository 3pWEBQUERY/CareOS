import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import {
  deleteDashboardLayout,
  getDashboardLayout,
  normalizeDashboardLayout,
  saveDashboardLayout,
} from "@/lib/dashboard-layout";

export const runtime = "nodejs";

async function sessionUser() {
  const cookieStore = await cookies();
  return getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
}

function databaseError(error: unknown) {
  if (error instanceof Error && error.message === "DATABASE_URL_NOT_CONFIGURED")
    return NextResponse.json({ error: "Datenbank ist nicht konfiguriert." }, { status: 503 });
  console.error("Dashboard layout request failed", error);
  return NextResponse.json({ error: "Arbeitsplatz konnte nicht gespeichert werden." }, { status: 500 });
}

export async function GET() {
  try {
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    return NextResponse.json({ layout: await getDashboardLayout(user.id) });
  } catch (error) {
    return databaseError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const layout = normalizeDashboardLayout(await request.json());
    if (!layout) return NextResponse.json({ error: "Ungültiges Arbeitsplatzlayout." }, { status: 400 });
    await saveDashboardLayout(user.id, layout);
    return NextResponse.json({ layout });
  } catch (error) {
    return databaseError(error);
  }
}

export async function DELETE() {
  try {
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    await deleteDashboardLayout(user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return databaseError(error);
  }
}
