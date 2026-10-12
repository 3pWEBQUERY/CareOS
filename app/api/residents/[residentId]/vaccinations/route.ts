import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createVaccination, vaccinationList } from "@/lib/vaccinations";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

// Impfungen der Person.
export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await vaccinationList(ctx, (await params).residentId));
  } catch (error) {
    return apiErrorResponse(error, "Die Impfungen konnten nicht geladen werden.");
  }
}

// Erfassen ({ givenOn, target, vaccine?, lot?, place, givenBy?, note? }).
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await createVaccination(ctx, (await params).residentId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Die Impfung konnte nicht gespeichert werden.");
  }
}
