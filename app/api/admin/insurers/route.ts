import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { readInsurers, saveInsurers } from "@/lib/insurers";

export const runtime = "nodejs";

// Versicherungen zur Auswahl in der Akte: Vorgabe je Land, von der Administration anpassbar.
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await readInsurers(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Versicherungen konnten nicht geladen werden.");
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await saveInsurers(ctx, body));
  } catch (error) {
    return apiErrorResponse(error, "Die Versicherungen konnten nicht gespeichert werden.");
  }
}
