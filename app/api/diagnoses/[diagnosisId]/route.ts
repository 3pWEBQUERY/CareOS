import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { deleteDiagnosis, updateDiagnosis } from "@/lib/diagnoses";

export const runtime = "nodejs";
type Context = { params: Promise<{ diagnosisId: string }> };

// Ändern (dieselben Felder wie beim Erfassen, dazu { updatedAt } gegen gleichzeitige Änderungen).
export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await updateDiagnosis(ctx, (await params).diagnosisId, body));
  } catch (error) {
    return apiErrorResponse(error, "Die Diagnose konnte nicht gespeichert werden.");
  }
}

// Fehleintrag entfernen ({ reason }).
export async function DELETE(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await deleteDiagnosis(ctx, (await params).diagnosisId, body));
  } catch (error) {
    return apiErrorResponse(error, "Die Diagnose konnte nicht entfernt werden.");
  }
}
