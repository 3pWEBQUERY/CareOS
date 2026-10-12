import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { reviewRestraint } from "@/lib/restraints";

export const runtime = "nodejs";

// Überprüfung einer Massnahme: weiterführen mit neuem Termin oder beenden.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await reviewRestraint(ctx, body.id, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Überprüfung konnte nicht gespeichert werden.");
  }
}
