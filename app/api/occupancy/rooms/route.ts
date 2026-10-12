import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveRoom } from "@/lib/occupancy";

export const runtime = "nodejs";

// Zimmer anlegen.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await saveRoom(ctx, null, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Zimmer konnte nicht angelegt werden.");
  }
}
