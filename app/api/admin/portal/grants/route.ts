import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createPortalGrant, revokePortalGrant, updatePortalGrant } from "@/lib/portal-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json({ id: await createPortalGrant(ctx, body.accountId, body) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Die Freigabe konnte nicht gespeichert werden.");
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    await updatePortalGrant(ctx, body.id, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Freigabe konnte nicht gespeichert werden.");
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { id?: unknown };
    await revokePortalGrant(ctx, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Freigabe konnte nicht widerrufen werden.");
  }
}
