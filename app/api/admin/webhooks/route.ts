import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createWebhook, deleteWebhook, listWebhooks } from "@/lib/webhooks";

export const runtime = "nodejs";

// Webhooks der Einrichtung (Administration).
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ webhooks: await listWebhooks(ctx) });
  } catch (error) {
    return apiErrorResponse(error, "Webhooks konnten nicht geladen werden.");
  }
}

// { name, url, events } – das Geheimnis für die Signatur steht nur in dieser Antwort.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { name?: unknown; url?: unknown; events?: unknown };
    return NextResponse.json(await createWebhook(ctx, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "Webhook konnte nicht angelegt werden.");
  }
}

// { webhookId } – entfernt den Webhook samt ausstehender Meldungen.
export async function DELETE(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { webhookId?: unknown };
    await deleteWebhook(ctx, body.webhookId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Webhook konnte nicht entfernt werden.");
  }
}
