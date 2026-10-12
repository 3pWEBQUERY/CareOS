import { NextResponse } from "next/server";
import { ApiError, apiContext, apiErrorResponse } from "@/lib/api-context";
import {
  createInteractionRule,
  deleteInteractionRule,
  listInteractionRules,
  updateInteractionRule,
} from "@/lib/medication-interactions";

export const runtime = "nodejs";

// Hinweise zu Wechselwirkungen, erfasst von der Einrichtung. Pflegen darf, wer Verordnungen verwaltet.
export async function GET() {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await listInteractionRules(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Hinweise zu Wechselwirkungen konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const id = await createInteractionRule(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Hinweis konnte nicht gespeichert werden.");
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    await updateInteractionRule(ctx, body.id, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Hinweis konnte nicht gespeichert werden.");
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { id?: unknown };
    if (!body.id) throw new ApiError("Hinweis fehlt.");
    await deleteInteractionRule(ctx, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Hinweis konnte nicht entfernt werden.");
  }
}
