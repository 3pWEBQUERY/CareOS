import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { listCatalog, saveCatalogItem } from "@/lib/services";

export const runtime = "nodejs";

// Leistungskatalog der Einrichtung (inkl. inaktiver Einträge für die Administration).
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ items: await listCatalog(ctx, true) });
  } catch (error) {
    return apiErrorResponse(error, "Leistungskatalog konnte nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await saveCatalogItem(ctx, null, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Leistung konnte nicht angelegt werden.");
  }
}
