import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, num, text, type ApiContext, type Row } from "@/lib/api-context";
import { type StockItem, type StockMovement } from "@/lib/medication-shared";
import { DATE } from "./medication";
import { medicationId } from "./medication-orders";
import { witnessFor } from "./medication-btm";

// -------------------------------------------------------------------- stock

export async function listStock({
  sql,
  actor,
}: ApiContext): Promise<{ items: StockItem[]; movements: StockMovement[] }> {
  const [items, movements] = (await Promise.all([
    sql`
      SELECT st.id, st.medication_id, m.name, COALESCE(m.strength, '') AS strength, COALESCE(m.form, '') AS form, m.is_controlled,
        CASE WHEN st.resident_id IS NOT NULL THEN r.first_name || ' ' || r.last_name ELSE COALESCE(cu.name, 'Ohne Wohnbereich') END AS owner,
        (st.resident_id IS NOT NULL) AS is_resident, COALESCE(st.storage_location, '') AS location, st.quantity, st.unit,
        st.minimum_quantity, to_char(st.expires_on, 'YYYY-MM-DD') AS expires_on, COALESCE(st.batch_number, '') AS batch, st.updated_at
      FROM carecore_medication_stock st
      JOIN carecore_medications m ON m.id = st.medication_id
      LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id
      LEFT JOIN carecore_residents r ON r.id = st.resident_id
      WHERE st.organization_id = ${actor.organizationId}
      ORDER BY m.name, m.strength, owner`,
    sql`
      SELECT mv.id, mv.created_at, TRIM(CONCAT_WS(' ', m.name, m.strength)) AS medication,
        CASE WHEN r.id IS NULL THEN NULL ELSE r.first_name || ' ' || r.last_name END AS resident_name,
        mv.delta, mv.reason, mv.note, u.display_name AS user_name
      FROM carecore_medication_stock_movements mv
      JOIN carecore_medications m ON m.id = mv.medication_id
      LEFT JOIN carecore_residents r ON r.id = mv.resident_id
      LEFT JOIN carecore_users u ON u.id = mv.created_by
      WHERE mv.organization_id = ${actor.organizationId}
      ORDER BY mv.created_at DESC LIMIT 30`,
  ])) as [Row[], Row[]];
  return {
    items: items.map((row) => ({
      id: String(row.id),
      medicationId: String(row.medication_id),
      name: String(row.name),
      strength: String(row.strength),
      form: String(row.form),
      owner: String(row.owner),
      ownerKind: row.is_resident ? "resident" : "unit",
      location: String(row.location),
      quantity: Number(row.quantity),
      unit: String(row.unit),
      minimum: num(row.minimum_quantity),
      expiresOn: (row.expires_on as string | null) ?? null,
      batch: String(row.batch),
      updatedAt: iso(row.updated_at) ?? "",
      controlled: Boolean(row.is_controlled),
    })),
    movements: movements.map(mapMovement),
  };
}

export function mapMovement(row: Row): StockMovement {
  return {
    id: String(row.id),
    createdAt: iso(row.created_at) ?? "",
    medication: String(row.medication),
    residentName: (row.resident_name as string | null) ?? null,
    delta: Number(row.delta),
    reason: row.reason as StockMovement["reason"],
    note: (row.note as string | null) ?? null,
    userName: (row.user_name as string | null) ?? null,
  };
}

export async function listResidentMovements(ctx: ApiContext, residentIdInput: unknown): Promise<StockMovement[]> {
  const residentId = await assertResident(ctx, residentIdInput);
  const rows = (await ctx.sql`
    SELECT mv.id, mv.created_at, TRIM(CONCAT_WS(' ', m.name, m.strength)) AS medication, NULL AS resident_name,
      mv.delta, mv.reason, mv.note, u.display_name AS user_name
    FROM carecore_medication_stock_movements mv
    JOIN carecore_medications m ON m.id = mv.medication_id
    LEFT JOIN carecore_users u ON u.id = mv.created_by
    WHERE mv.organization_id = ${ctx.actor.organizationId} AND mv.resident_id = ${residentId}
    ORDER BY mv.created_at DESC LIMIT 15`) as Row[];
  return rows.map(mapMovement);
}

export async function recordMovement(
  ctx: ApiContext,
  stockId: string,
  medId: string,
  residentId: string | null,
  delta: number,
  reason: StockMovement["reason"],
  note: string,
  witnessId: string | null = null,
) {
  await ctx.sql`
    INSERT INTO carecore_medication_stock_movements (id, organization_id, stock_id, medication_id, resident_id, delta, reason, note, created_by, witness_user_id)
    VALUES (${randomUUID()}, ${ctx.actor.organizationId}, ${stockId}, ${medId}, ${residentId}, ${delta}, ${reason}, ${note || null}, ${ctx.actor.id}, ${witnessId})`;
}

export const quantityValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100000 ? value : null;

// Receipt into an existing stock row or a new one (ward stock or resident-owned).
export async function receiveStock(ctx: ApiContext, body: Record<string, unknown>) {
  const quantity = quantityValue(body.quantity);
  if (!quantity) throw new ApiError("Bitte eine Menge größer als 0 angeben.");
  const note = text(body.note, 1000);
  if (typeof body.stockId === "string") {
    const stockId = assertUuid(body.stockId, "Bestand");
    const current =
      (await ctx.sql`SELECT medication_id FROM carecore_medication_stock WHERE id = ${stockId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
    if (!current[0]) throw new ApiError("Bestand nicht gefunden.", 404);
    // Betäubungsmittel: Eingang nur mit Zweitunterschrift.
    const witness = await witnessFor(ctx, String(current[0].medication_id), body.witness);
    const rows = (await ctx.sql`
      UPDATE carecore_medication_stock SET quantity = quantity + ${quantity}, updated_at = NOW()
      WHERE id = ${stockId} AND organization_id = ${ctx.actor.organizationId}
      RETURNING id, medication_id, resident_id`) as Row[];
    if (!rows[0]) throw new ApiError("Bestand nicht gefunden.", 404);
    await recordMovement(
      ctx,
      stockId,
      String(rows[0].medication_id),
      (rows[0].resident_id as string | null) ?? null,
      quantity,
      "receipt",
      note,
      witness?.id ?? null,
    );
    return stockId;
  }
  const name = text(body.name, 220);
  const unit = text(body.unit, 32);
  if (!name || !unit) throw new ApiError("Präparat und Einheit sind erforderlich.");
  let careUnitId: string | null = null;
  let residentId: string | null = null;
  if (typeof body.residentId === "string" && body.residentId) residentId = await assertResident(ctx, body.residentId);
  else {
    careUnitId = assertUuid(body.careUnitId, "Wohnbereich");
    const unitRows =
      await ctx.sql`SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id WHERE cu.id = ${careUnitId} AND si.organization_id = ${ctx.actor.organizationId} LIMIT 1`;
    if (!unitRows[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  }
  const expiresOn = typeof body.expiresOn === "string" && DATE.test(body.expiresOn) ? body.expiresOn : null;
  const minimum = typeof body.minimum === "number" && body.minimum >= 0 ? body.minimum : null;
  const medId = await medicationId(ctx, name, text(body.strength, 80), text(body.form, 80));
  const witness = await witnessFor(ctx, medId, body.witness);
  const batch = text(body.batch, 100) || null;
  // Same medication, owner, batch and unit: add to the existing row instead of creating a duplicate.
  const existing = (await ctx.sql`
    UPDATE carecore_medication_stock SET quantity = quantity + ${quantity}, updated_at = NOW()
    WHERE id = (
      SELECT id FROM carecore_medication_stock
      WHERE organization_id = ${ctx.actor.organizationId} AND medication_id = ${medId} AND unit = ${unit}
        AND care_unit_id IS NOT DISTINCT FROM ${careUnitId}::uuid AND resident_id IS NOT DISTINCT FROM ${residentId}::uuid
        AND batch_number IS NOT DISTINCT FROM ${batch}::varchar
      LIMIT 1)
    RETURNING id`) as Row[];
  if (existing[0]) {
    await recordMovement(
      ctx,
      String(existing[0].id),
      medId,
      residentId,
      quantity,
      "receipt",
      note,
      witness?.id ?? null,
    );
    return String(existing[0].id);
  }
  const id = randomUUID();
  await ctx.sql`
    INSERT INTO carecore_medication_stock (id, organization_id, care_unit_id, resident_id, medication_id, quantity, unit, minimum_quantity, expires_on, batch_number, storage_location)
    VALUES (${id}, ${ctx.actor.organizationId}, ${careUnitId}, ${residentId}, ${medId}, ${quantity}, ${unit}, ${minimum}, ${expiresOn}, ${batch}, ${text(body.location, 160) || null})`;
  await recordMovement(
    ctx,
    id,
    medId,
    residentId,
    quantity,
    "receipt",
    note || "Neuer Bestand angelegt",
    witness?.id ?? null,
  );
  return id;
}

// Correction or disposal: sets the counted quantity and journals the difference.
export async function correctStock(ctx: ApiContext, stockIdInput: unknown, body: Record<string, unknown>) {
  const stockId = assertUuid(stockIdInput, "Bestand");
  const note = text(body.note, 1000);
  const reason = body.reason === "disposal" ? "disposal" : "correction";
  if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity) || body.quantity < 0)
    throw new ApiError("Bitte den gezählten Bestand angeben.");
  const rows =
    (await ctx.sql`SELECT id, medication_id, resident_id, quantity FROM carecore_medication_stock WHERE id = ${stockId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Bestand nicht gefunden.", 404);
  const delta = body.quantity - Number(rows[0].quantity);
  if (delta !== 0 && !note) throw new ApiError("Bitte einen Grund für die Bestandsänderung angeben.");
  // Betäubungsmittel: Mengenänderungen (Korrektur, Entsorgung) nur mit Zweitunterschrift.
  const witness = delta !== 0 ? await witnessFor(ctx, String(rows[0].medication_id), body.witness) : null;
  const expiresOn = typeof body.expiresOn === "string" && DATE.test(body.expiresOn) ? body.expiresOn : null;
  const minimum = typeof body.minimum === "number" && body.minimum >= 0 ? body.minimum : null;
  await ctx.sql`
    UPDATE carecore_medication_stock SET quantity = ${body.quantity}, minimum_quantity = ${minimum}, expires_on = ${expiresOn},
      storage_location = ${text(body.location, 160) || null}, updated_at = NOW()
    WHERE id = ${stockId}`;
  if (delta !== 0)
    await recordMovement(
      ctx,
      stockId,
      String(rows[0].medication_id),
      (rows[0].resident_id as string | null) ?? null,
      delta,
      reason,
      note,
      witness?.id ?? null,
    );
}
