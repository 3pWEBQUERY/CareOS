import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { fridgeOverview, saveFridge } from "@/lib/fridges";

export const runtime = "nodejs";

// Medikamentenkühlschränke mit Messungen der letzten 31 Tage.
export async function GET() {
  try {
    const ctx = await apiContext();
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await fridgeOverview(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Kühlschränke konnten nicht geladen werden.");
  }
}

// Anlegen oder mit { id } ändern.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await saveFridge(ctx, body));
  } catch (error) {
    return apiErrorResponse(error, "Der Kühlschrank konnte nicht gespeichert werden.");
  }
}
