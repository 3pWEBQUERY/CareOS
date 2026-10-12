import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { revokeConsent } from "@/lib/consents";

export const runtime = "nodejs";

// Widerruf eines Entscheids ({ revokedOn, note? }).
export async function PATCH(request: Request, { params }: { params: Promise<{ consentId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await revokeConsent(ctx, (await params).consentId, body));
  } catch (error) {
    return apiErrorResponse(error, "Der Widerruf konnte nicht gespeichert werden.");
  }
}
