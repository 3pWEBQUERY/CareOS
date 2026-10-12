import { NextResponse } from "next/server";
import { requestIdFrom } from "@/lib/request-receipts";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { addMeal } from "@/lib/nutrition";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      { id: await addMeal(ctx, (await request.json()) as Record<string, unknown>, requestIdFrom(request)) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Mahlzeiteneintrag konnte nicht gespeichert werden.");
  }
}
