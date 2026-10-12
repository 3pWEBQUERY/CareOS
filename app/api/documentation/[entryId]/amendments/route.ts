import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { amendEntry } from "@/lib/documentation";

export const runtime = "nodejs";
type Context = { params: Promise<{ entryId: string }> };

// Corrections are stored as new entries; the original is never changed.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { entryId } = await params;
    return NextResponse.json(
      { id: await amendEntry(ctx, entryId, (await request.json()) as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Korrektur konnte nicht gespeichert werden.");
  }
}
