import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { actionsData, createAction } from "@/lib/quality";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await actionsData(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Massnahmen konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const id = await createAction(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Massnahme konnte nicht angelegt werden.");
  }
}
