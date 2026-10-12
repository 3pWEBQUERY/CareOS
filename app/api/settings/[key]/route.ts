import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveHiddenVitals, saveSetting, saveTerminology } from "@/lib/settings";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { key } = await params;
    if (key === "vitals")
      return NextResponse.json({
        hiddenVitals: await saveHiddenVitals(ctx, (await request.json()) as Record<string, unknown>),
      });
    if (key === "terminology")
      return NextResponse.json({
        terminology: await saveTerminology(ctx, (await request.json()) as Record<string, unknown>),
      });
    return NextResponse.json({
      settings: await saveSetting(ctx, key, (await request.json()) as Record<string, unknown>),
    });
  } catch (error) {
    return apiErrorResponse(error, "Einstellung konnte nicht gespeichert werden.");
  }
}
