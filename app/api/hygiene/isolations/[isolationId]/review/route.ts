import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { reviewIsolation } from "@/lib/hygiene";

export const runtime = "nodejs";

type Context = { params: Promise<{ isolationId: string }> };

// Isolation überprüfen: weiterführen oder aufheben.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { isolationId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await reviewIsolation(ctx, isolationId, body));
  } catch (error) {
    return apiErrorResponse(error, "Überprüfung konnte nicht gespeichert werden.");
  }
}
