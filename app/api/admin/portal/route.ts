import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createPortalAccount, listPortalAccounts, updatePortalAccount } from "@/lib/portal-admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await listPortalAccounts(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Portal-Zugänge konnten nicht geladen werden.");
  }
}

// Neuer Zugang; das Einmal-Passwort steht nur in dieser Antwort.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await createPortalAccount(ctx, (await request.json()) as Record<string, unknown>), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "Der Portal-Zugang konnte nicht angelegt werden.");
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    await updatePortalAccount(ctx, body.id, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Der Portal-Zugang konnte nicht gespeichert werden.");
  }
}
