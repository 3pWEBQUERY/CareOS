import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { recordParticipation } from "@/lib/activities";

export const runtime = "nodejs";

type Context = { params: Promise<{ activityId: string }> };

// Teilnahme je Person erfassen.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { activityId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await recordParticipation(ctx, activityId, body));
  } catch (error) {
    return apiErrorResponse(error, "Teilnahme konnte nicht gespeichert werden.");
  }
}
