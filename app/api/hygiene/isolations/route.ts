import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createIsolation } from "@/lib/hygiene";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await createIsolation(ctx, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Isolation konnte nicht erfasst werden.");
  }
}
