import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { listOrders, updateMedicationAllergies } from "@/lib/medication-orders";
import { listResidentMovements } from "@/lib/medication-stock";
import { listEffectChecks } from "@/lib/medication-effect";
import { residentInteractions } from "@/lib/medication-interactions";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    const [orders, movements, effectChecks, interactions] = await Promise.all([
      listOrders(ctx, residentId),
      listResidentMovements(ctx, residentId),
      listEffectChecks(ctx, residentId),
      residentInteractions(ctx, residentId),
    ]);
    return NextResponse.json({ orders, movements, effectChecks, interactions });
  } catch (error) {
    return apiErrorResponse(error, "Medikation konnte nicht geladen werden.");
  }
}

// Updates the documented medication allergies of the resident.
export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    const body = (await request.json()) as { allergies?: unknown };
    return NextResponse.json({ allergies: await updateMedicationAllergies(ctx, residentId, body.allergies) });
  } catch (error) {
    return apiErrorResponse(error, "Allergien konnten nicht gespeichert werden.");
  }
}
