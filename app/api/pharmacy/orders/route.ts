import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse, type Row } from "@/lib/api-context";
import { cancelOrder, createOrder, listOrders, listPharmacies } from "@/lib/pharmacy";

export const runtime = "nodejs";

// Bestellungen bei der Apotheke (wer Verordnungen verwaltet).
export async function GET() {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const [orders, pharmacies, units, residents] = await Promise.all([
      listOrders(ctx),
      listPharmacies(ctx),
      ctx.sql`
        SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
        WHERE s.organization_id = ${ctx.actor.organizationId} AND cu.active ORDER BY cu.name` as Promise<Row[]>,
      ctx.sql`
        SELECT id, first_name || ' ' || last_name AS name FROM carecore_residents
        WHERE organization_id = ${ctx.actor.organizationId} AND status = 'active' ORDER BY last_name, first_name` as Promise<
        Row[]
      >,
    ]);
    return NextResponse.json({
      orders,
      pharmacies,
      careUnits: units.map((row) => ({ id: String(row.id), name: String(row.name) })),
      residents: residents.map((row) => ({ id: String(row.id), name: String(row.name) })),
    });
  } catch (error) {
    return apiErrorResponse(error, "Bestellungen konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      { id: await createOrder(ctx, (await request.json()) as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Die Bestellung konnte nicht gespeichert werden.");
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { id?: unknown };
    await cancelOrder(ctx, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Bestellung konnte nicht storniert werden.");
  }
}
