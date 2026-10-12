import { NextResponse } from "next/server";
import { residentAudit } from "@/lib/resident-audit";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

type SupplyInput = {
  itemName?: unknown;
  category?: unknown;
  unit?: unknown;
  currentQuantity?: unknown;
  targetQuantity?: unknown;
  status?: unknown;
  notes?: unknown;
};

async function supplyContext(residentId: string, supplyId: string) {
  const actor = await carecoreActor();
  if (!actor?.organizationId) return null;
  const sql = carecoreDb();
  const rows =
    await sql`SELECT s.id FROM carecore_resident_supplies s INNER JOIN carecore_residents r ON r.id = s.resident_id WHERE s.id = ${supplyId} AND s.resident_id = ${residentId} AND r.organization_id = ${actor.organizationId} LIMIT 1`;
  return rows[0] ? { actor, sql } : null;
}

function supplyValues(input: SupplyInput) {
  const text = (key: keyof SupplyInput, limit: number) =>
    typeof input[key] === "string" ? input[key].trim().slice(0, limit) : "";
  const quantity = (key: "currentQuantity" | "targetQuantity") =>
    typeof input[key] === "number" && Number.isInteger(input[key])
      ? Math.max(0, Math.min(100000, input[key] as number))
      : 0;
  const status = input.status === "blocked" || input.status === "archived" ? input.status : "active";
  return {
    itemName: text("itemName", 180),
    category: text("category", 80) || "Pflege & Hygiene",
    unit: text("unit", 40) || "Stück",
    currentQuantity: quantity("currentQuantity"),
    targetQuantity: quantity("targetQuantity"),
    status,
    notes: text("notes", 2000),
  };
}

async function supplySnapshot(sql: ReturnType<typeof carecoreDb>, supplyId: string) {
  const rows =
    await sql`SELECT item_name, category, unit, current_quantity, target_quantity, status, notes FROM carecore_resident_supplies WHERE id = ${supplyId}`;
  const row = rows[0];
  return row
    ? {
        itemName: row.item_name,
        category: row.category,
        unit: row.unit,
        currentQuantity: Number(row.current_quantity),
        targetQuantity: Number(row.target_quantity),
        status: row.status,
        notes: row.notes,
      }
    : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ residentId: string; supplyId: string }> }) {
  try {
    const { residentId, supplyId } = await context.params;
    const active = await supplyContext(residentId, supplyId);
    if (!active) return NextResponse.json({ error: "Pflegebedarf nicht verfügbar." }, { status: 404 });
    if (!hasPermission(active.actor, "residents.write")) return forbidden();
    const input = supplyValues((await request.json()) as SupplyInput);
    if (!input.itemName) return NextResponse.json({ error: "Bitte gib eine Bezeichnung an." }, { status: 400 });
    const before = await supplySnapshot(active.sql, supplyId);
    const [rows] = await active.sql.transaction([
      active.sql`UPDATE carecore_resident_supplies SET item_name = ${input.itemName}, category = ${input.category}, unit = ${input.unit}, current_quantity = ${input.currentQuantity}, target_quantity = ${input.targetQuantity}, status = ${input.status}, notes = ${input.notes || null}, updated_by = ${active.actor.id}, updated_at = NOW() WHERE id = ${supplyId} RETURNING id, product_id, item_name, category, unit, current_quantity, target_quantity, status, notes, updated_at`,
      residentAudit(active.sql, active.actor, {
        residentId,
        entityType: "resident_supply",
        entityId: supplyId,
        action: "updated",
        before,
        after: input,
      }),
    ]);
    return NextResponse.json({ supply: rows[0] });
  } catch (error) {
    console.error("Supplies PATCH failed", error);
    return NextResponse.json({ error: "Pflegebedarf konnte nicht aktualisiert werden." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ residentId: string; supplyId: string }> },
) {
  try {
    const { residentId, supplyId } = await context.params;
    const active = await supplyContext(residentId, supplyId);
    if (!active) return NextResponse.json({ error: "Pflegebedarf nicht verfügbar." }, { status: 404 });
    if (!hasPermission(active.actor, "residents.write")) return forbidden();
    const before = await supplySnapshot(active.sql, supplyId);
    await active.sql.transaction([
      active.sql`DELETE FROM carecore_resident_supplies WHERE id = ${supplyId}`,
      residentAudit(active.sql, active.actor, {
        residentId,
        entityType: "resident_supply",
        entityId: supplyId,
        action: "deleted",
        before,
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Supplies DELETE failed", error);
    return NextResponse.json({ error: "Pflegebedarf konnte nicht entfernt werden." }, { status: 500 });
  }
}
