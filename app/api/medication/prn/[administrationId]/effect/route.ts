import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { recordEffectCheck } from "@/lib/medication-effect";

export const runtime = "nodejs";

// Wirkungskontrolle einer Reservegabe erfassen: { result: effective|partial|none, note? }
export async function POST(request: Request, { params }: { params: Promise<{ administrationId: string }> }) {
  try {
    const ctx = await apiContext("medication.administer");
    if (ctx instanceof NextResponse) return ctx;
    const { administrationId } = await params;
    await recordEffectCheck(ctx, administrationId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Wirkungskontrolle konnte nicht gespeichert werden.");
  }
}
