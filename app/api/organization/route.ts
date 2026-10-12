import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { organizationStructure } from "@/lib/organization";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await organizationStructure(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Organisation konnte nicht geladen werden.");
  }
}
