import { randomUUID } from "node:crypto";
import {
  ApiError,
  assertUuid,
  auditStatement,
  iso,
  text,
  type ApiContext,
  type Row,
  type Sql,
} from "@/lib/api-context";
import type { PortalActor } from "@/lib/portal";
import { ORDER_STATUSES, type OrderStatus, type PharmacyOrder, type PharmacyOrderItem } from "@/lib/portal-shared";
import { hasPermission } from "@/lib/server-data";

// Apothekenportal: Die Einrichtung bestellt Medikamente bei einer Apotheke (Portal-Zugang der Art „Apotheke“); die
// Apotheke sieht nur die an sie gerichteten Bestellungen, bestätigt sie (mit voraussichtlichem Liefertag), meldet die
// Lieferung oder lehnt mit Begründung ab. Bestellen und stornieren darf, wer Verordnungen verwaltet. Eine Lieferung
// verbucht die Pflege wie bisher als Eingang im Bestand.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 30;

function requireManager(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "medication.manage"))
    throw new ApiError("Bestellungen bei der Apotheke verwaltet, wer Verordnungen verwalten darf.", 403);
}

const orderSelect = (sql: Sql, where: { organizationId: string; accountId?: string; orderId?: string }) => sql`
  SELECT o.*, to_char(o.expected_on, 'YYYY-MM-DD') AS expected_on, a.display_name AS pharmacy_name,
    cu.name AS care_unit_name, u.display_name AS requested_by_name,
    NULLIF(TRIM(COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')), '') AS resident_name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('medication', i.medication, 'strength', i.strength,
      'quantity', i.quantity, 'unit', i.unit, 'note', i.note) ORDER BY i.position)
      FROM carecore_pharmacy_order_items i WHERE i.order_id = o.id), '[]'::jsonb) AS items
  FROM carecore_pharmacy_orders o
  JOIN carecore_portal_accounts a ON a.id = o.account_id
  LEFT JOIN carecore_care_units cu ON cu.id = o.care_unit_id
  LEFT JOIN carecore_residents r ON r.id = o.resident_id
  LEFT JOIN carecore_users u ON u.id = o.requested_by
  WHERE o.organization_id = ${where.organizationId}
    AND (${where.accountId ?? null}::uuid IS NULL OR o.account_id = ${where.accountId ?? null}::uuid)
    AND (${where.orderId ?? null}::uuid IS NULL OR o.id = ${where.orderId ?? null}::uuid)
  ORDER BY (o.status IN ('open', 'confirmed')) DESC, o.created_at DESC
  LIMIT 200`;

const mapOrder = (row: Row): PharmacyOrder => ({
  id: String(row.id),
  pharmacyId: String(row.account_id),
  pharmacyName: String(row.pharmacy_name),
  careUnit: (row.care_unit_name as string | null) ?? null,
  residentName: (row.resident_name as string | null) ?? null,
  status: row.status as OrderStatus,
  note: String(row.note),
  pharmacyNote: String(row.pharmacy_note),
  expectedOn: (row.expected_on as string | null) ?? null,
  requestedBy: (row.requested_by_name as string | null) ?? null,
  createdAt: iso(row.created_at) ?? "",
  updatedAt: iso(row.updated_at) ?? "",
  items: (Array.isArray(row.items) ? row.items : []).map((item: Record<string, unknown>) => ({
    medication: String(item.medication),
    strength: String(item.strength ?? ""),
    quantity: Number(item.quantity),
    unit: String(item.unit),
    note: String(item.note ?? ""),
  })),
});

// ---------- Einrichtung ----------

export async function listPharmacies(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT id, display_name FROM carecore_portal_accounts
    WHERE organization_id = ${ctx.actor.organizationId} AND kind = 'pharmacy' AND active
    ORDER BY LOWER(display_name)`) as Row[];
  return rows.map((row) => ({ id: String(row.id), name: String(row.display_name) }));
}

export async function listOrders(ctx: ApiContext) {
  requireManager(ctx);
  return ((await orderSelect(ctx.sql, { organizationId: ctx.actor.organizationId })) as Row[]).map(mapOrder);
}

function parseItems(input: unknown): PharmacyOrderItem[] {
  const list = Array.isArray(input) ? input.slice(0, MAX_ITEMS + 1) : [];
  if (list.length > MAX_ITEMS) throw new ApiError(`Höchstens ${MAX_ITEMS} Positionen je Bestellung.`);
  const items = list.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const quantity = typeof item.quantity === "number" ? item.quantity : Number(item.quantity);
    return {
      medication: text(item.medication, 220),
      strength: text(item.strength, 80),
      quantity,
      unit: text(item.unit, 40),
      note: text(item.note, 500),
    };
  });
  if (!items.length) throw new ApiError("Bitte mindestens ein Präparat angeben.");
  for (const item of items) {
    if (!item.medication) throw new ApiError("Bitte bei jeder Position das Präparat angeben.");
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 100000)
      throw new ApiError(`Bitte eine gültige Menge für „${item.medication}“ angeben.`);
    if (!item.unit) throw new ApiError(`Bitte die Einheit für „${item.medication}“ angeben (z. B. Packungen).`);
  }
  return items;
}

export async function createOrder(ctx: ApiContext, body: Record<string, unknown>) {
  requireManager(ctx);
  const org = ctx.actor.organizationId;
  const accountId = assertUuid(body.pharmacyId, "Apotheke");
  const [pharmacy] = (await ctx.sql`
    SELECT id FROM carecore_portal_accounts
    WHERE id = ${accountId} AND organization_id = ${org} AND kind = 'pharmacy' AND active`) as Row[];
  if (!pharmacy) throw new ApiError("Apotheke nicht gefunden.", 404);
  const careUnitId = body.careUnitId ? assertUuid(body.careUnitId, "Wohnbereich") : null;
  if (careUnitId) {
    const found = (await ctx.sql`
      SELECT 1 FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE cu.id = ${careUnitId} AND s.organization_id = ${org}`) as Row[];
    if (!found.length) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  }
  const residentId = body.residentId ? assertUuid(body.residentId, "Person") : null;
  if (residentId) {
    const found = (await ctx.sql`
      SELECT 1 FROM carecore_residents WHERE id = ${residentId} AND organization_id = ${org}`) as Row[];
    if (!found.length) throw new ApiError("Person nicht gefunden.", 404);
  }
  const items = parseItems(body.items);
  const note = text(body.note, 2000);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_pharmacy_orders (id, organization_id, account_id, care_unit_id, resident_id, note, requested_by)
      VALUES (${id}, ${org}, ${accountId}, ${careUnitId}, ${residentId}, ${note}, ${ctx.actor.id})`,
    ...items.map(
      (item, position) => ctx.sql`
        INSERT INTO carecore_pharmacy_order_items (id, order_id, position, medication, strength, quantity, unit, note)
        VALUES (${randomUUID()}, ${id}, ${position}, ${item.medication}, ${item.strength}, ${item.quantity}, ${item.unit}, ${item.note})`,
    ),
    auditStatement(ctx, "pharmacy_order", id, "created", null, { accountId, careUnitId, residentId, items, note }),
  ]);
  return id;
}

export async function cancelOrder(ctx: ApiContext, orderInput: unknown) {
  requireManager(ctx);
  const id = assertUuid(orderInput, "Bestellung");
  const updated = (await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_pharmacy_orders SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId} AND status IN ('open', 'confirmed')
      RETURNING id`,
    auditStatement(ctx, "pharmacy_order", id, "cancelled", null, null),
  ])) as Row[][];
  if (!updated[0][0]) throw new ApiError("Nur offene oder bestätigte Bestellungen lassen sich stornieren.", 409);
}

// ---------- Apotheke (Portal) ----------

function requirePharmacy(actor: PortalActor) {
  if (actor.kind !== "pharmacy") throw new ApiError("Bestellungen sehen nur Apotheken.", 403);
}

export async function pharmacyOrders(sql: Sql, actor: PortalActor) {
  requirePharmacy(actor);
  return ((await orderSelect(sql, { organizationId: actor.organizationId, accountId: actor.id })) as Row[]).map(
    mapOrder,
  );
}

// Übergänge: offen → bestätigt/abgelehnt, bestätigt → geliefert/abgelehnt.
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  open: ["confirmed", "rejected", "delivered"],
  confirmed: ["delivered", "rejected"],
  delivered: [],
  rejected: [],
  cancelled: [],
};

export async function updateOrderByPharmacy(
  sql: Sql,
  actor: PortalActor,
  orderInput: unknown,
  body: Record<string, unknown>,
) {
  requirePharmacy(actor);
  const id = assertUuid(orderInput, "Bestellung");
  const status = typeof body.status === "string" && body.status in ORDER_STATUSES ? (body.status as OrderStatus) : null;
  if (!status) throw new ApiError("Unbekannter Status.");
  const note = text(body.note, 2000);
  if (status === "rejected" && !note) throw new ApiError("Bitte einen Grund für die Ablehnung angeben.");
  const expectedOn = typeof body.expectedOn === "string" && DATE.test(body.expectedOn) ? body.expectedOn : null;
  const [order] = (await sql`
    SELECT id, status, resident_id, note FROM carecore_pharmacy_orders
    WHERE id = ${id} AND account_id = ${actor.id} AND organization_id = ${actor.organizationId}`) as Row[];
  if (!order) throw new ApiError("Bestellung nicht gefunden.", 404);
  if (!NEXT[order.status as OrderStatus].includes(status))
    throw new ApiError(`Die Bestellung ist bereits „${ORDER_STATUSES[order.status as OrderStatus]}“.`, 409);
  const title = `Apotheke ${actor.displayName}: Bestellung ${ORDER_STATUSES[status].toLowerCase()}`;
  await sql.transaction([
    sql`
      UPDATE carecore_pharmacy_orders SET status = ${status}, updated_at = NOW(),
        pharmacy_note = CASE WHEN ${note} = '' THEN pharmacy_note ELSE ${note} END,
        expected_on = COALESCE(${expectedOn}::date, expected_on)
      WHERE id = ${id}`,
    sql`
      INSERT INTO carecore_portal_access_log (id, organization_id, account_id, resident_id, action, user_agent)
      VALUES (${randomUUID()}, ${actor.organizationId}, ${actor.id}, ${(order.resident_id as string | null) ?? null},
        ${`order_${status}`}, ${actor.userAgent?.slice(0, 300) ?? null})`,
    sql`
      INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
      SELECT gen_random_uuid(), u.id, ${title}, ${note || (expectedOn ? `Lieferung voraussichtlich ${expectedOn}` : "Status geändert")},
        'message_portal', ${status === "rejected" ? "high" : "normal"}, '/c/medikation/bestellungen', 'pharmacy_order', ${id}
      FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
      WHERE p.organization_id = ${actor.organizationId} AND u.active AND u.archived_at IS NULL
        AND carecore_effective_permissions(u.id) ? 'medication.manage'`,
  ]);
}
