import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { createRestraint, listRestraints, updateRestraint } from "@/lib/restraints";

export const runtime = "nodejs";

// Freiheitsbeschränkende Massnahmen einer Person: lesen mit Zugriff auf die Akte, erfassen und korrigieren mit
// Bearbeitungsrecht.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const residentId = new URL(request.url).searchParams.get("residentId");
    return NextResponse.json({
      measures: await listRestraints(ctx, residentId),
      canWrite: hasPermission(ctx.actor, "residents.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Massnahmen konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await createRestraint(ctx, (await request.json()) as Record<string, unknown>), {
      status: 201,
    });
  } catch (error) {
    return apiErrorResponse(error, "Massnahme konnte nicht gespeichert werden.");
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    await updateRestraint(ctx, body.id, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Massnahme konnte nicht gespeichert werden.");
  }
}
