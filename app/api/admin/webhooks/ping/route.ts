import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { pingWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";

// { webhookId } – Probemeldung, zugestellt nach dieser Antwort.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { webhookId?: unknown };
    await pingWebhook(ctx, body.webhookId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Probemeldung konnte nicht vorgemerkt werden.");
  }
}
