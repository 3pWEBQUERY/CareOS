import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { updateTemplate } from "@/lib/care-templates";

export const runtime = "nodejs";

// { kind, ... } ändern oder { kind, archive: true } ausblenden.
export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    await updateTemplate(ctx, (await params).templateId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Vorlage konnte nicht gespeichert werden.");
  }
}
