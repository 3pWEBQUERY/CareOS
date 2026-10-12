import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { readInsurers } from "@/lib/insurers";

export const runtime = "nodejs";

// Auswahl der Versicherung in den Stammdaten (Land der Einrichtung).
export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await readInsurers(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Versicherungen konnten nicht geladen werden.");
  }
}
