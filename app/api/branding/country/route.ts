import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveOrganizationCountry } from "@/lib/organization-country";

export const runtime = "nodejs";

// Land und Kanton bzw. Bundesland der Einrichtung festlegen (Administration).
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { country?: unknown; region?: unknown };
    return NextResponse.json(await saveOrganizationCountry(ctx, body.country, body.region));
  } catch (error) {
    return apiErrorResponse(error, "Das Land konnte nicht gespeichert werden.");
  }
}
