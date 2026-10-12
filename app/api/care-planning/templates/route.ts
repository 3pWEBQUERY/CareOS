import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission, forbidden } from "@/lib/server-data";
import { careTemplates, createTemplate } from "@/lib/care-templates";

export const runtime = "nodejs";

// Vorlagen lesen: wer plant (Dokumentieren) oder Vorlagen pflegt (Qualität).
export async function GET() {
  try {
    const ctx = await apiContext();
    if (ctx instanceof NextResponse) return ctx;
    if (!hasPermission(ctx.actor, "documentation.write") && !hasPermission(ctx.actor, "quality.manage"))
      return forbidden();
    return NextResponse.json(await careTemplates(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Vorlagen konnten nicht geladen werden.");
  }
}

// { kind: "goal" | "intervention", ... } – neue Vorlage.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await createTemplate(ctx, (await request.json()) as Record<string, unknown>), {
      status: 201,
    });
  } catch (error) {
    return apiErrorResponse(error, "Die Vorlage konnte nicht gespeichert werden.");
  }
}
