import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { confirmProofs, proofView } from "@/lib/intervention-proofs";

export const runtime = "nodejs";

// Geplante Massnahmen je Person für Tag und Tageszeit (?careUnitId=…&date=YYYY-MM-DD&dayPart=morning|noon|evening|night).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(
      await proofView(ctx, {
        careUnitId: params.get("careUnitId"),
        date: params.get("date"),
        dayPart: params.get("dayPart"),
      }),
    );
  } catch (error) {
    return apiErrorResponse(error, "Durchführungsnachweis konnte nicht geladen werden.");
  }
}

// { residentId, date, dayPart, deviations: [{ interventionId, outcome, reason }] } – übrige Massnahmen wie geplant.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await confirmProofs(ctx, (await request.json()) as Record<string, unknown>), {
      status: 201,
    });
  } catch (error) {
    return apiErrorResponse(error, "Nachweis konnte nicht gespeichert werden.");
  }
}
