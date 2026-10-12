import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { cancelServiceRecord } from "@/lib/services";

export const runtime = "nodejs";

// Leistung mit Begründung stornieren.
export async function POST(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { recordId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    await cancelServiceRecord(ctx, recordId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Leistung konnte nicht storniert werden.");
  }
}
