import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { activityDetail, updateActivity } from "@/lib/activities";

export const runtime = "nodejs";

type Context = { params: Promise<{ activityId: string }> };

// Angebot mit den Personen und der erfassten Teilnahme.
export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { activityId } = await params;
    return NextResponse.json(await activityDetail(ctx, activityId));
  } catch (error) {
    return apiErrorResponse(error, "Angebot konnte nicht geladen werden.");
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { activityId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    await updateActivity(ctx, activityId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Angebot konnte nicht gespeichert werden.");
  }
}
