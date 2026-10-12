import { NextResponse, type NextRequest } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import {
  addAbsence,
  addCareLevel,
  assignRate,
  billingPerson,
  cancelBillingEntry,
  endAssignedRate,
  updateAbsence,
} from "@/lib/billing";
import { saveBillingAddress } from "@/lib/invoices";

export const runtime = "nodejs";

type Params = { params: Promise<{ residentId: string }> };

// Pflegestufe, Abwesenheiten, zusätzliche Taxen und Vorschau des Monats (?month=YYYY-MM).
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      await billingPerson(ctx, (await params).residentId, request.nextUrl.searchParams.get("month")),
    );
  } catch (error) {
    return apiErrorResponse(error, "Die Abrechnung konnte nicht geladen werden.");
  }
}

const TABLES = { level: "levels", absence: "absences", rate: "rates" } as const;

// { action: "careLevel" | "absence" | "updateAbsence" | "assign" | "endRate" | "cancel", … }
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body: Record<string, unknown> = {
      ...((await request.json()) as Record<string, unknown>),
      residentId: (await params).residentId,
    };
    switch (body.action) {
      case "careLevel":
        return NextResponse.json(await addCareLevel(ctx, body), { status: 201 });
      case "absence":
        return NextResponse.json(await addAbsence(ctx, body), { status: 201 });
      case "assign":
        return NextResponse.json(await assignRate(ctx, body), { status: 201 });
      case "updateAbsence":
        await updateAbsence(ctx, body.id, body);
        break;
      case "address":
        await saveBillingAddress(ctx, body);
        break;
      case "endRate":
        await endAssignedRate(ctx, body.id, body);
        break;
      case "cancel": {
        const table = TABLES[String(body.kind) as keyof typeof TABLES];
        if (!table) return NextResponse.json({ error: "Unbekannter Eintrag." }, { status: 400 });
        await cancelBillingEntry(ctx, table, body.id, body);
        break;
      }
      default:
        return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Änderung konnte nicht gespeichert werden.");
  }
}
