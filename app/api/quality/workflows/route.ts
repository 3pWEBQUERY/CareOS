import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { readEventTypes } from "@/lib/quality-types";
import { listWorkflows, saveWorkflow } from "@/lib/quality-workflows";

export const runtime = "nodejs";

// Ablaufketten je Ereignisart: lesen (alle, die melden dürfen), ändern (Qualitätsmanagement).
export async function GET() {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const [workflows, types] = await Promise.all([listWorkflows(ctx), readEventTypes(ctx)]);
    return NextResponse.json({ workflows, eventTypes: types.all });
  } catch (error) {
    return apiErrorResponse(error, "Ablaufketten konnten nicht geladen werden.");
  }
}

// { type, steps: [{ title, description?, category, priority, dueOffsetMinutes, documentOnCompletion? }] }
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { type?: unknown; steps?: unknown };
    return NextResponse.json({ steps: await saveWorkflow(ctx, body.type, body.steps) });
  } catch (error) {
    return apiErrorResponse(error, "Ablaufkette konnte nicht gespeichert werden.");
  }
}
