import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";

// Schlüssel der öffentlichen Schnittstelle (Administration).
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ keys: await listApiKeys(ctx) });
  } catch (error) {
    return apiErrorResponse(error, "Schlüssel konnten nicht geladen werden.");
  }
}

// { name, scopes } – der Schlüssel steht nur in dieser Antwort.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { name?: unknown; scopes?: unknown };
    return NextResponse.json(await createApiKey(ctx, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "Schlüssel konnte nicht erstellt werden.");
  }
}

// { keyId } – widerrufen; der Eintrag bleibt fürs Protokoll.
export async function DELETE(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { keyId?: unknown };
    await revokeApiKey(ctx, body.keyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Schlüssel konnte nicht widerrufen werden.");
  }
}
