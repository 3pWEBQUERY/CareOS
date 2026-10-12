import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { billingCatalog, createRate, saveBillingSettings } from "@/lib/billing";

export const runtime = "nodejs";

// Taxen der Einrichtung und Regeln der Abrechnung.
export async function GET() {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await billingCatalog(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Taxen konnten nicht geladen werden.");
  }
}

// Neue Taxe.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await createRate(ctx, (await request.json()) as Record<string, unknown>), {
      status: 201,
    });
  } catch (error) {
    return apiErrorResponse(error, "Die Taxe konnte nicht gespeichert werden.");
  }
}

// { dischargeDayBilled } – Regel zum Austrittstag.
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    await saveBillingSettings(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Regel konnte nicht gespeichert werden.");
  }
}
