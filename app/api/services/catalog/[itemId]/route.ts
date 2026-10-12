import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveCatalogItem } from "@/lib/services";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { itemId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await saveCatalogItem(ctx, itemId, body));
  } catch (error) {
    return apiErrorResponse(error, "Leistung konnte nicht gespeichert werden.");
  }
}
