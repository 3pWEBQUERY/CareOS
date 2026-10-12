import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { raiWorkplace } from "@/lib/rai";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await raiWorkplace(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Der Kompass konnte nicht geladen werden.");
  }
}
