import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { residentAudit } from "@/lib/resident-audit";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";
import { auditOrigin } from "@/lib/audit-origin";

export const runtime = "nodejs";

type SupplyInput = {
  itemName?: unknown;
  productId?: unknown;
  quantity?: unknown;
  category?: unknown;
  unit?: unknown;
  currentQuantity?: unknown;
  targetQuantity?: unknown;
  status?: unknown;
  notes?: unknown;
};

async function residentContext(residentId: string) {
  const actor = await carecoreActor();
  if (!actor?.organizationId) return null;
  const sql = carecoreDb();
  const resident =
    await sql`SELECT id FROM carecore_residents WHERE id = ${residentId} AND organization_id = ${actor.organizationId} LIMIT 1`;
  return resident[0] ? { actor, sql } : null;
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

export async function GET(_request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await context.params;
    const active = await residentContext(residentId);
    if (!active) return NextResponse.json({ error: "Akte nicht verfügbar." }, { status: 404 });
    if (!hasPermission(active.actor, "residents.read")) return forbidden();
    const [supplies, products] = await Promise.all([
      active.sql`SELECT id, product_id, item_name, category, unit, current_quantity, target_quantity, status, notes, updated_at FROM carecore_resident_supplies WHERE resident_id = ${residentId} ORDER BY status = 'active' DESC, category, item_name`,
      active.sql`SELECT id, item_name, category, unit, default_target_quantity FROM carecore_care_supply_products WHERE organization_id = ${active.actor.organizationId} AND status = 'active' ORDER BY category, item_name`,
    ]);
    return NextResponse.json({ supplies, products });
  } catch (error) {
    console.error("Supplies GET failed", error);
    return NextResponse.json({ error: "Pflegebedarf konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await context.params;
    const active = await residentContext(residentId);
    if (!active) return NextResponse.json({ error: "Akte nicht verfügbar." }, { status: 404 });
    if (!hasPermission(active.actor, "residents.write")) return forbidden();
    const body = (await request.json()) as SupplyInput;
    if (typeof body.productId === "string" && body.productId) {
      const quantity =
        typeof body.quantity === "number" && Number.isInteger(body.quantity)
          ? Math.max(1, Math.min(100000, body.quantity))
          : 0;
      const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
      if (!quantity)
        return NextResponse.json(
          { error: "Bitte gib eine Stückzahl oder Menge grösser als null an." },
          { status: 400 },
        );
      const sql = active.sql;
      const supplyId = randomUUID();
      const transactionId = randomUUID();
      const rows = await sql`
        WITH product AS (
          SELECT id, item_name, category, unit, default_target_quantity
          FROM carecore_care_supply_products
          WHERE id = ${body.productId} AND organization_id = ${active.actor.organizationId} AND status = 'active'
        ), resident_scope AS (
          SELECT id FROM carecore_residents WHERE id = ${residentId} AND organization_id = ${active.actor.organizationId}
        ), upserted AS (
          INSERT INTO carecore_resident_supplies (id, resident_id, product_id, item_name, category, unit, current_quantity, target_quantity, status, notes, updated_by)
          SELECT ${supplyId}, ${residentId}, product.id, product.item_name, product.category, product.unit, ${quantity}, product.default_target_quantity, 'active', NULLIF(${notes}, ''), ${active.actor.id}
          FROM product CROSS JOIN resident_scope
          ON CONFLICT (resident_id, product_id) WHERE product_id IS NOT NULL
          DO UPDATE SET current_quantity = carecore_resident_supplies.current_quantity + EXCLUDED.current_quantity,
            target_quantity = GREATEST(carecore_resident_supplies.target_quantity, EXCLUDED.target_quantity),
            status = 'active', notes = COALESCE(NULLIF(EXCLUDED.notes, ''), carecore_resident_supplies.notes),
            updated_by = EXCLUDED.updated_by, updated_at = NOW()
          RETURNING id, product_id, resident_id, item_name, category, unit, current_quantity, target_quantity, status, notes, updated_at
        ), recorded AS (
          INSERT INTO carecore_resident_supply_transactions (id, resident_id, product_id, resident_supply_id, quantity, action, notes, created_by)
          SELECT ${transactionId}, ${residentId}, product.id, upserted.id, ${quantity}, 'issued', NULLIF(${notes}, ''), ${active.actor.id}
          FROM upserted JOIN product ON product.id = upserted.product_id
          RETURNING id
        ), audited AS (
          INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
          SELECT gen_random_uuid(), ${active.actor.organizationId}, ${active.actor.id}, ${auditOrigin(active.actor).sessionId}, ${auditOrigin(active.actor).userAgent}, 'resident_supply', upserted.id, 'issued',
            jsonb_build_object('residentId', ${residentId}::text, 'productId', upserted.product_id, 'itemName', upserted.item_name,
              'quantity', ${quantity}::int, 'unit', upserted.unit, 'notes', NULLIF(${notes}, ''))
          FROM upserted
          RETURNING id
        ), stocked AS (
          -- Issuing to a resident takes the quantity from the house stock of the catalog.
          UPDATE carecore_care_supply_products
          SET current_stock_quantity = GREATEST(0, current_stock_quantity - ${quantity}), updated_at = NOW()
          WHERE id IN (SELECT product_id FROM upserted)
          RETURNING current_stock_quantity, min_stock_quantity
        )
        SELECT upserted.*, stocked.current_stock_quantity AS stock_left, stocked.min_stock_quantity AS min_stock
        FROM upserted CROSS JOIN recorded LEFT JOIN stocked ON TRUE`;
      if (!rows[0]) return NextResponse.json({ error: "Das Pflegeprodukt ist nicht mehr verfügbar." }, { status: 404 });
      const stockLeft = Number(rows[0].stock_left ?? 0);
      const minStock = Number(rows[0].min_stock ?? 0);
      // Crossing the minimum stock notifies the administration once.
      if (minStock > 0 && stockLeft <= minStock && stockLeft + quantity > minStock)
        await sql`
          INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
          SELECT gen_random_uuid(), u.id, ${`Nachbestellen: ${rows[0].item_name}`},
            ${`Bestand ${stockLeft} ${rows[0].unit} – Mindestbestand ${minStock}.`}, 'supply_low', 'high',
            '/c/leitung/administration/pflegebedarf'
          FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id JOIN carecore_roles r ON r.key = u.role
          WHERE p.organization_id = ${active.actor.organizationId} AND u.active AND u.archived_at IS NULL
            AND r.permissions ? 'administration.manage'`;
      return NextResponse.json({ supply: rows[0], transactionId }, { status: 201 });
    }
    const input = supplyValues(body);
    if (!input.itemName) return NextResponse.json({ error: "Bitte gib eine Bezeichnung an." }, { status: 400 });
    const id = randomUUID();
    const [rows] = await active.sql.transaction([
      active.sql`INSERT INTO carecore_resident_supplies (id, resident_id, item_name, category, unit, current_quantity, target_quantity, status, notes, updated_by) VALUES (${id}, ${residentId}, ${input.itemName}, ${input.category}, ${input.unit}, ${input.currentQuantity}, ${input.targetQuantity}, ${input.status}, ${input.notes || null}, ${active.actor.id}) RETURNING id, item_name, category, unit, current_quantity, target_quantity, status, notes, updated_at`,
      residentAudit(active.sql, active.actor, {
        residentId,
        entityType: "resident_supply",
        entityId: id,
        action: "created",
        after: input,
      }),
    ]);
    return NextResponse.json({ supply: rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Supplies POST failed", error);
    return NextResponse.json({ error: "Pflegebedarf konnte nicht gespeichert werden." }, { status: 500 });
  }
}
