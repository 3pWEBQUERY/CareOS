import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createOrder, parseOrderInput } from "@/lib/medication-orders";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    const id = await createOrder(ctx, body.residentId, parseOrderInput(body));
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Verordnung konnte nicht gespeichert werden.");
  }
}
