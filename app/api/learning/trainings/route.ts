import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createTraining } from "@/lib/learning-trainings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("team.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      { id: await createTraining(ctx, (await request.json()) as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Schulung konnte nicht angelegt werden.");
  }
}
