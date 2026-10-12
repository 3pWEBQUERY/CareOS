import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { cancelProof } from "@/lib/intervention-proofs";

export const runtime = "nodejs";
type Context = { params: Promise<{ proofId: string }> };

// { reason } – Nachweis stornieren (bleibt im Protokoll); danach lässt sich neu nachweisen.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    await cancelProof(ctx, (await params).proofId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Nachweis konnte nicht storniert werden.");
  }
}
