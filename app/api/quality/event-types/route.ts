import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveEventTypes } from "@/lib/quality-types";

export const runtime = "nodejs";

// Eigene Ereignisarten der Einrichtung ersetzen (Qualitätsmanagement): { custom: string[] }
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { custom?: unknown };
    return NextResponse.json({ custom: await saveEventTypes(ctx, body.custom) });
  } catch (error) {
    return apiErrorResponse(error, "Ereignisarten konnten nicht gespeichert werden.");
  }
}
