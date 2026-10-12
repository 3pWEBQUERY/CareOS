import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { documentScheduledDose, listRound } from "@/lib/medication-round";
import { ROUNDS, type RoundKey } from "@/lib/medication-shared";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    const round = params.get("round") as RoundKey;
    if (!(round in ROUNDS)) return NextResponse.json({ error: "Unbekannte Runde." }, { status: 400 });
    return NextResponse.json(await listRound(ctx, round, params.get("date")));
  } catch (error) {
    return apiErrorResponse(error, "Medikamentenrunde konnte nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("medication.administer");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await documentScheduledDose(ctx, (await request.json()) as Record<string, unknown>));
  } catch (error) {
    return apiErrorResponse(error, "Gabe konnte nicht dokumentiert werden.");
  }
}
