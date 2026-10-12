import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createDiagnosis, diagnosisList } from "@/lib/diagnoses";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

// Diagnosen der Person (wie von Ärztin/Arzt gestellt).
export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await diagnosisList(ctx, (await params).residentId));
  } catch (error) {
    return apiErrorResponse(error, "Die Diagnosen konnten nicht geladen werden.");
  }
}

// Erfassen ({ label, icdCode?, kind, sinceOn?, source?, status, resolvedOn?, note? }).
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await createDiagnosis(ctx, (await params).residentId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Die Diagnose konnte nicht gespeichert werden.");
  }
}
