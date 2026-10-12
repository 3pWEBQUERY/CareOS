import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { listCareUnits } from "@/lib/medication";
import { btmOverview } from "@/lib/medication-btm";
import { listMedicationResidents } from "@/lib/medication-orders";
import { hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

// BtM-Kontrolle: Bestände der Betäubungsmittel mit letzter Kontrolle und alle Präparate zur Kennzeichnung.
export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const [overview, careUnits, residents] = await Promise.all([
      btmOverview(ctx),
      listCareUnits(ctx),
      listMedicationResidents(ctx),
    ]);
    return NextResponse.json({
      ...overview,
      careUnits,
      residents: residents.map(({ id, name }) => ({ id, name })),
      canManage: hasPermission(ctx.actor, "medication.manage"),
    });
  } catch (error) {
    return apiErrorResponse(error, "BtM-Bestände konnten nicht geladen werden.");
  }
}
