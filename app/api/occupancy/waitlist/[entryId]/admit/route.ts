import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { planAdmission } from "@/lib/occupancy";

export const runtime = "nodejs";

type Context = { params: Promise<{ entryId: string }> };

// Eintritt aus der Warteliste planen.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const { entryId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await planAdmission(ctx, entryId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Eintritt konnte nicht geplant werden.");
  }
}
