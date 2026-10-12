import { randomUUID } from "node:crypto";
import { authenticate, isLoginThrottled, recordFailedLogin } from "./auth";
import { ApiError, assertUuid, iso, text, type ApiContext, type Row } from "./api-context";
import type { BtmBook, BtmBookEntry, BtmOverview } from "./medication-btm-shared";
import { readSettings } from "./settings";
import { auditOrigin } from "@/lib/audit-origin";

// Betäubungsmittel (BtM): Buchungen brauchen eine zweite Person (Zeugin/Zeuge), die sich mit ihrem
// eigenen Passwort bestätigt. Fehlversuche zählen wie fehlgeschlagene Anmeldungen.
const WITNESS_CHANNEL = "btm-witness";

export type Witness = { id: string; name: string };

export async function verifyWitness(ctx: ApiContext, input: unknown): Promise<Witness> {
  const witness = (input ?? {}) as Record<string, unknown>;
  const username = text(witness.username, 120);
  const password = typeof witness.password === "string" ? witness.password : "";
  if (!username || !password)
    throw new ApiError(
      "Für Betäubungsmittel ist eine Zweitunterschrift nötig: Benutzername und Passwort der zweiten Person.",
    );
  if (await isLoginThrottled(username, WITNESS_CHANNEL))
    throw new ApiError("Zu viele Fehlversuche für diese Person. Bitte später erneut versuchen.", 429);
  const user = await authenticate(username, password);
  if (!user) {
    await recordFailedLogin(username, WITNESS_CHANNEL);
    throw new ApiError("Die Zweitunterschrift ist ungültig: Benutzername oder Passwort stimmt nicht.", 403);
  }
  if (user.id === ctx.actor.id) throw new ApiError("Die Zweitunterschrift muss von einer anderen Person stammen.", 403);
  const rows = (await ctx.sql`
    SELECT COALESCE(carecore_effective_permissions(u.id), '[]'::jsonb) AS permissions FROM carecore_user_profiles p
    JOIN carecore_users u ON u.id = p.user_id AND u.active AND u.archived_at IS NULL
    WHERE p.user_id = ${user.id} AND p.organization_id = ${ctx.actor.organizationId}`) as Row[];
  const permissions = Array.isArray(rows[0]?.permissions) ? (rows[0].permissions as string[]) : null;
  if (!permissions) throw new ApiError("Die zweite Person gehört nicht zu dieser Organisation.", 403);
  if (!permissions.includes("medication.administer") && !permissions.includes("medication.manage"))
    throw new ApiError("Die zweite Person ist nicht für Medikation berechtigt.", 403);
  return { id: user.id, name: user.display_name };
}

// Zweitunterschrift bei der Gabe: nur für Betäubungsmittel und nur, wenn die Einrichtung sie verlangt.
export async function administrationWitness(ctx: ApiContext, medicationId: string | null, input: unknown) {
  if (!medicationId || !(await readSettings(ctx)).btmAdministrationWitness.enabled) return null;
  if (!(await isControlledMedication(ctx, medicationId))) return null;
  return verifyWitness(ctx, input);
}

export async function isControlledMedication(ctx: ApiContext, medicationId: string) {
  const rows =
    (await ctx.sql`SELECT is_controlled FROM carecore_medications WHERE id = ${medicationId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  return Boolean(rows[0]?.is_controlled);
}

// Zeugin/Zeuge nur für BtM verlangen; sonst null.
export async function witnessFor(ctx: ApiContext, medicationId: string, input: unknown) {
  return (await isControlledMedication(ctx, medicationId)) ? verifyWitness(ctx, input) : null;
}

// Kontrollintervall in Tagen aus Leitung › Konfiguration (null, solange es nicht festgelegt und eingeschaltet ist).
export async function btmCountInterval(ctx: ApiContext) {
  const setting = (await readSettings(ctx)).btmCountInterval;
  return setting.enabled && setting.value ? setting.value : null;
}

// Erinnerung beim Laden der Benachrichtigungen: fällige BtM-Kontrollen für Personen mit Medikationsrecht,
// je Bestand einmal pro Kontrollzyklus. Mit Stammwohnbereich nur dessen Stations- und Bewohnerbestände.
export async function createBtmReminders(ctx: ApiContext) {
  if (!ctx.actor.permissions.includes("medication.manage")) return;
  const interval = await btmCountInterval(ctx);
  if (interval === null) return;
  await ctx.sql`
    WITH home AS (SELECT primary_care_unit_id AS unit FROM carecore_user_profiles WHERE user_id = ${ctx.actor.id}),
    due AS (
      SELECT st.id, TRIM(CONCAT_WS(' ', m.name, m.strength)) AS medication,
        CASE WHEN st.resident_id IS NOT NULL THEN r.first_name || ' ' || r.last_name ELSE COALESCE(cu.name, 'Ohne Wohnbereich') END AS owner,
        last_count.created_at AS last_count_at
      FROM carecore_medication_stock st
      JOIN carecore_medications m ON m.id = st.medication_id AND m.is_controlled
      LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id
      LEFT JOIN carecore_residents r ON r.id = st.resident_id
      LEFT JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = st.resident_id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN LATERAL (SELECT created_at FROM carecore_btm_counts c WHERE c.stock_id = st.id ORDER BY c.created_at DESC LIMIT 1) last_count ON TRUE
      CROSS JOIN (SELECT (SELECT unit FROM home) AS unit) h
      WHERE st.organization_id = ${ctx.actor.organizationId}
        AND (h.unit IS NULL OR COALESCE(stay.care_unit_id, st.care_unit_id) = h.unit)
        AND (last_count.created_at IS NULL OR last_count.created_at + make_interval(days => ${interval}::int) <= NOW())
    )
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    SELECT gen_random_uuid(), ${ctx.actor.id}, 'BtM-Kontrolle fällig: ' || due.medication,
      due.owner || CASE WHEN due.last_count_at IS NULL THEN ' · noch nie kontrolliert.' ELSE ' · letzte Kontrolle am ' ||
        to_char(due.last_count_at AT TIME ZONE COALESCE((SELECT timezone FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}), 'Europe/Zurich'), 'DD.MM.YYYY') || '.' END,
      'btm_count_due', 'normal', '/c/medikation/btm', 'btm_stock', due.id
    FROM due
    WHERE NOT EXISTS (SELECT 1 FROM carecore_notifications n
      WHERE n.user_id = ${ctx.actor.id} AND n.type = 'btm_count_due' AND n.entity_type = 'btm_stock' AND n.entity_id = due.id
        AND n.created_at > COALESCE(due.last_count_at, '-infinity'::timestamptz))`;
}

export async function btmOverview(ctx: ApiContext): Promise<BtmOverview> {
  const { sql, actor } = ctx;
  const interval = await btmCountInterval(ctx);
  const [stock, medications] = (await Promise.all([
    sql`
      SELECT st.id, st.medication_id, m.name, COALESCE(m.strength, '') AS strength, COALESCE(m.form, '') AS form,
        CASE WHEN st.resident_id IS NOT NULL THEN r.first_name || ' ' || r.last_name ELSE COALESCE(cu.name, 'Ohne Wohnbereich') END AS owner,
        (st.resident_id IS NOT NULL) AS is_resident, COALESCE(st.storage_location, '') AS location, st.quantity, st.unit,
        last_count.created_at AS last_count_at, last_count.expected_quantity AS last_expected, last_count.counted_quantity AS last_counted,
        cb.display_name AS last_counted_by, wb.display_name AS last_witness,
        (SELECT MAX(created_at) FROM carecore_medication_stock_movements mv WHERE mv.stock_id = st.id) AS last_movement_at,
        last_count.created_at + make_interval(days => ${interval}::int) AS count_due_at
      FROM carecore_medication_stock st
      JOIN carecore_medications m ON m.id = st.medication_id AND m.is_controlled
      LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id
      LEFT JOIN carecore_residents r ON r.id = st.resident_id
      LEFT JOIN LATERAL (SELECT * FROM carecore_btm_counts c WHERE c.stock_id = st.id ORDER BY c.created_at DESC LIMIT 1) last_count ON TRUE
      LEFT JOIN carecore_users cb ON cb.id = last_count.counted_by
      LEFT JOIN carecore_users wb ON wb.id = last_count.witness_user_id
      WHERE st.organization_id = ${actor.organizationId}
      ORDER BY m.name, m.strength, owner`,
    sql`
      SELECT m.id, m.name, COALESCE(m.strength, '') AS strength, COALESCE(m.form, '') AS form, m.is_controlled,
        EXISTS (SELECT 1 FROM carecore_medication_stock st WHERE st.medication_id = m.id) AS has_stock
      FROM carecore_medications m WHERE m.organization_id = ${actor.organizationId}
      ORDER BY m.is_controlled DESC, m.name, m.strength`,
  ])) as [Row[], Row[]];
  return {
    countInterval: interval,
    items: stock.map((row) => ({
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
      lastMovementAt: iso(row.last_movement_at),
      // Mit festgelegtem Intervall: nie kontrollierte Bestände sind sofort fällig.
      countDue:
        interval === null
          ? null
          : { at: iso(row.count_due_at), due: !row.count_due_at || new Date(String(row.count_due_at)) <= new Date() },
      lastCount: row.last_count_at
        ? {
            at: iso(row.last_count_at) ?? "",
            expected: Number(row.last_expected),
            counted: Number(row.last_counted),
            countedBy: (row.last_counted_by as string | null) ?? null,
            witness: (row.last_witness as string | null) ?? null,
          }
        : null,
    })),
    medications: medications.map((row) => ({
      id: String(row.id),
      name: [row.name, row.strength].filter(Boolean).join(" "),
      form: String(row.form),
      controlled: Boolean(row.is_controlled),
      hasStock: Boolean(row.has_stock),
    })),
  };
}

// BtM-Buch einer Bestandsposition: alle Buchungen mit laufendem Bestand (rückwärts vom aktuellen Bestand
// gerechnet, damit auch ein Übertrag aus der Zeit vor der Kennzeichnung stimmt).
export async function btmBook(ctx: ApiContext, stockIdInput: unknown): Promise<BtmBook> {
  const stockId = assertUuid(stockIdInput, "Bestand");
  const stock = (await ctx.sql`
    SELECT st.id, st.quantity, st.unit, m.name, COALESCE(m.strength, '') AS strength, m.is_controlled,
      CASE WHEN st.resident_id IS NOT NULL THEN r.first_name || ' ' || r.last_name ELSE COALESCE(cu.name, 'Ohne Wohnbereich') END AS owner
    FROM carecore_medication_stock st JOIN carecore_medications m ON m.id = st.medication_id
    LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id LEFT JOIN carecore_residents r ON r.id = st.resident_id
    WHERE st.id = ${stockId} AND st.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!stock[0]) throw new ApiError("Bestand nicht gefunden.", 404);
  const rows = (await ctx.sql`
    SELECT mv.id, mv.created_at, mv.delta, mv.reason, mv.note, u.display_name AS user_name, w.display_name AS witness_name,
      CASE WHEN r.id IS NULL THEN NULL ELSE r.first_name || ' ' || r.last_name END AS resident_name,
      ${Number(stock[0].quantity)}::numeric - COALESCE(SUM(mv.delta) OVER (ORDER BY mv.created_at DESC, mv.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS balance,
      c.expected_quantity, c.counted_quantity
    FROM carecore_medication_stock_movements mv
    LEFT JOIN carecore_users u ON u.id = mv.created_by
    LEFT JOIN carecore_users w ON w.id = mv.witness_user_id
    LEFT JOIN carecore_residents r ON r.id = mv.resident_id
    LEFT JOIN carecore_btm_counts c ON c.movement_id = mv.id
    WHERE mv.stock_id = ${stockId}
    ORDER BY mv.created_at DESC, mv.id DESC`) as Row[];
  const counts = (await ctx.sql`
    SELECT c.id, c.created_at, c.expected_quantity, c.counted_quantity, c.note, u.display_name AS user_name, w.display_name AS witness_name
    FROM carecore_btm_counts c LEFT JOIN carecore_users u ON u.id = c.counted_by LEFT JOIN carecore_users w ON w.id = c.witness_user_id
    WHERE c.stock_id = ${stockId} AND c.movement_id IS NULL ORDER BY c.created_at DESC`) as Row[];
  const entries: BtmBookEntry[] = [
    ...rows.map((row) => ({
      id: String(row.id),
      at: iso(row.created_at) ?? "",
      kind: row.expected_quantity !== null ? ("count" as const) : (String(row.reason) as BtmBookEntry["kind"]),
      delta: Number(row.delta),
      balance: Number(row.balance),
      note: (row.note as string | null) ?? null,
      user: (row.user_name as string | null) ?? null,
      witness: (row.witness_name as string | null) ?? null,
      resident: (row.resident_name as string | null) ?? null,
      expected: row.expected_quantity === null ? null : Number(row.expected_quantity),
      counted: row.counted_quantity === null ? null : Number(row.counted_quantity),
    })),
    // Kontrollen ohne Differenz erzeugen keine Buchung, gehören aber ins Buch.
    ...counts.map((row) => ({
      id: String(row.id),
      at: iso(row.created_at) ?? "",
      kind: "count" as const,
      delta: 0,
      balance: Number(row.counted_quantity),
      note: (row.note as string | null) ?? null,
      user: (row.user_name as string | null) ?? null,
      witness: (row.witness_name as string | null) ?? null,
      resident: null,
      expected: Number(row.expected_quantity),
      counted: Number(row.counted_quantity),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const opening = Number(stock[0].quantity) - rows.reduce((sum, row) => sum + Number(row.delta), 0);
  return {
    stock: {
      id: stockId,
      name: [stock[0].name, stock[0].strength].filter(Boolean).join(" "),
      owner: String(stock[0].owner),
      unit: String(stock[0].unit),
      quantity: Number(stock[0].quantity),
      controlled: Boolean(stock[0].is_controlled),
    },
    // Bestand vor der ersten Buchung (z. B. Übertrag bei nachträglicher Kennzeichnung).
    opening: Math.round(opening * 1000) / 1000,
    entries,
  };
}

// Bestandskontrolle: Zählung mit Zweitunterschrift. Eine Differenz braucht eine Begründung und wird als
// Korrektur gebucht; Kontrolle und Buchung entstehen gemeinsam.
export async function countStock(ctx: ApiContext, stockIdInput: unknown, body: Record<string, unknown>) {
  const stockId = assertUuid(stockIdInput, "Bestand");
  const counted = body.counted;
  if (typeof counted !== "number" || !Number.isFinite(counted) || counted < 0 || counted > 100000)
    throw new ApiError("Bitte den gezählten Bestand angeben.");
  const note = text(body.note, 1000);
  const rows = (await ctx.sql`
    SELECT st.id, st.medication_id, st.resident_id, st.quantity, m.is_controlled
    FROM carecore_medication_stock st JOIN carecore_medications m ON m.id = st.medication_id
    WHERE st.id = ${stockId} AND st.organization_id = ${ctx.actor.organizationId}`) as Row[];
  const stock = rows[0];
  if (!stock) throw new ApiError("Bestand nicht gefunden.", 404);
  if (!stock.is_controlled) throw new ApiError("Bestandskontrollen werden nur für Betäubungsmittel geführt.");
  const expected = Number(stock.quantity);
  const delta = Math.round((counted - expected) * 1000) / 1000;
  if (delta !== 0 && !note) throw new ApiError("Der gezählte Bestand weicht ab – bitte die Differenz begründen.");
  const witness = await verifyWitness(ctx, body.witness);
  const countId = randomUUID();
  const movementId = randomUUID();
  // Eine Anweisung: Bestand setzen (nur wenn er sich seit dem Laden nicht verändert hat), Differenz buchen
  // und Kontrolle festhalten – alles oder nichts.
  const result = (await ctx.sql`
    WITH updated AS (
      UPDATE carecore_medication_stock SET quantity = ${counted}, updated_at = NOW()
      WHERE id = ${stockId} AND quantity = ${expected}
      RETURNING id
    ), booked AS (
      INSERT INTO carecore_medication_stock_movements (id, organization_id, stock_id, medication_id, resident_id, delta, reason, note, created_by, witness_user_id)
      SELECT ${movementId}, ${ctx.actor.organizationId}, ${stockId}, ${stock.medication_id}, ${stock.resident_id}, ${delta}, 'correction',
        ${`Bestandskontrolle: ${note}`}, ${ctx.actor.id}, ${witness.id}
      FROM updated WHERE ${delta !== 0}
      RETURNING id
    )
    , counted AS (
      INSERT INTO carecore_btm_counts (id, organization_id, stock_id, medication_id, expected_quantity, counted_quantity, note, movement_id, counted_by, witness_user_id)
      SELECT ${countId}, ${ctx.actor.organizationId}, ${stockId}, ${stock.medication_id}, ${expected}, ${counted}, ${note || null},
        (SELECT id FROM booked), ${ctx.actor.id}, ${witness.id}
      FROM updated
      RETURNING id
    )
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
    SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'btm_count', counted.id, 'counted',
      ${JSON.stringify({ stockId, expected, counted, difference: delta, note: note || null, witness: witness.name })}::jsonb
    FROM counted
    RETURNING id`) as Row[];
  if (!result[0])
    throw new ApiError("Der Bestand hat sich während der Kontrolle verändert. Bitte neu laden und erneut zählen.", 409);
  return { difference: delta, witness: witness.name };
}

// Präparat als Betäubungsmittel führen oder die Kennzeichnung aufheben (mit Begründung).
export async function setControlled(ctx: ApiContext, medicationIdInput: unknown, body: Record<string, unknown>) {
  const medicationId = assertUuid(medicationIdInput, "Präparat");
  const controlled = body.controlled === true;
  const reason = text(body.reason, 500);
  if (!controlled && !reason)
    throw new ApiError("Bitte begründen, warum das Präparat nicht mehr als BtM geführt wird.");
  // Kennzeichnung und Protokoll in einer Anweisung.
  const rows = (await ctx.sql`
    WITH marked AS (
      UPDATE carecore_medications SET is_controlled = ${controlled}, updated_at = NOW()
      WHERE id = ${medicationId} AND organization_id = ${ctx.actor.organizationId} AND is_controlled IS DISTINCT FROM ${controlled}
      RETURNING id, name)
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
    SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'medication', marked.id,
      ${controlled ? "btm_marked" : "btm_unmarked"}, jsonb_build_object('name', marked.name, 'reason', ${reason || null}::text)
    FROM marked RETURNING entity_id`) as Row[];
  if (!rows[0]) {
    const exists =
      await ctx.sql`SELECT 1 FROM carecore_medications WHERE id = ${medicationId} AND organization_id = ${ctx.actor.organizationId}`;
    if (!exists[0]) throw new ApiError("Präparat nicht gefunden.", 404);
    return;
  }
}

// Entsorgung eines Betäubungsmittels (z. B. verfallen, beschädigt): Menge und Grund mit Zweitunterschrift.
export async function disposeStock(ctx: ApiContext, stockIdInput: unknown, body: Record<string, unknown>) {
  const stockId = assertUuid(stockIdInput, "Bestand");
  const quantity = body.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0)
    throw new ApiError("Bitte die entsorgte Menge angeben.");
  const note = text(body.note, 1000);
  if (!note) throw new ApiError("Bitte den Grund der Entsorgung angeben.");
  const rows = (await ctx.sql`
    SELECT st.id, st.medication_id, st.resident_id, st.quantity, m.is_controlled
    FROM carecore_medication_stock st JOIN carecore_medications m ON m.id = st.medication_id
    WHERE st.id = ${stockId} AND st.organization_id = ${ctx.actor.organizationId}`) as Row[];
  const stock = rows[0];
  if (!stock) throw new ApiError("Bestand nicht gefunden.", 404);
  if (quantity > Number(stock.quantity)) throw new ApiError("Es kann nicht mehr entsorgt werden, als vorhanden ist.");
  const witness = stock.is_controlled ? await verifyWitness(ctx, body.witness) : null;
  const result = (await ctx.sql`
    WITH updated AS (
      UPDATE carecore_medication_stock SET quantity = quantity - ${quantity}, updated_at = NOW()
      WHERE id = ${stockId} AND quantity >= ${quantity}
      RETURNING id
    )
    INSERT INTO carecore_medication_stock_movements (id, organization_id, stock_id, medication_id, resident_id, delta, reason, note, created_by, witness_user_id)
    SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${stockId}, ${stock.medication_id}, ${stock.resident_id}, ${-quantity}, 'disposal',
      ${note}, ${ctx.actor.id}, ${witness?.id ?? null}
    FROM updated
    RETURNING id`) as Row[];
  if (!result[0]) throw new ApiError("Der Bestand hat sich geändert. Bitte neu laden.", 409);
}
