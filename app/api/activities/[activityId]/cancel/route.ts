import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { cancelActivity } from "@/lib/activities";

export const runtime = "nodejs";

type Context = { params: Promise<{ activityId: string }> };

// Angebot mit Grund absagen.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { activityId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    await cancelActivity(ctx, activityId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Angebot konnte nicht abgesagt werden.");
  }
}
