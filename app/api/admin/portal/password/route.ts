import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { resetPortalPassword } from "@/lib/portal-admin";

export const runtime = "nodejs";

// Neues Einmal-Passwort; bestehende Sitzungen enden.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { accountId?: unknown };
    return NextResponse.json(await resetPortalPassword(ctx, body.accountId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "Das Passwort konnte nicht zurückgesetzt werden.");
  }
}
