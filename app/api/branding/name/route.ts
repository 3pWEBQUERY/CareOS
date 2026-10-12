import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveOrganizationName } from "@/lib/branding";

export const runtime = "nodejs";

// Name der Einrichtung ändern (Administration).
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { name?: unknown };
    return NextResponse.json({ name: await saveOrganizationName(ctx, body.name) });
  } catch (error) {
    return apiErrorResponse(error, "Der Name konnte nicht gespeichert werden.");
  }
}
