import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { learningData } from "@/lib/learning";

export const runtime = "nodejs";

// ?userId=<id>|all (leadership) selects whose mandatory evidence is shown; default is the signed-in person.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await learningData(ctx, new URL(request.url).searchParams));
  } catch (error) {
    return apiErrorResponse(error, "Schulungen konnten nicht geladen werden.");
  }
}
