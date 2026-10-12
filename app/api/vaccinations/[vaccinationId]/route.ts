import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { deleteVaccination } from "@/lib/vaccinations";

export const runtime = "nodejs";

// Fehleintrag entfernen ({ reason }).
export async function DELETE(request: Request, { params }: { params: Promise<{ vaccinationId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await deleteVaccination(ctx, (await params).vaccinationId, body));
  } catch (error) {
    return apiErrorResponse(error, "Die Impfung konnte nicht entfernt werden.");
  }
}
