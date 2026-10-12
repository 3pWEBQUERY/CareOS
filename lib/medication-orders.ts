import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, num, text, type ApiContext, type Row } from "@/lib/api-context";
import { initials, type MedOrder, type MedResident, type OrderInput } from "@/lib/medication-shared";
import { residentAudit } from "@/lib/resident-audit";
import { TIME, DATE } from "./medication";

export function parseOrderInput(body: Record<string, unknown>): OrderInput {
  const isPrn = body.isPrn === true;
  const input: OrderInput = {
    name: text(body.name, 220),
    strength: text(body.strength, 80),
    form: text(body.form, 80),
    route: text(body.route, 80) || "oral",
    amount: text(body.amount, 120),
    stockQuantity:
      typeof body.stockQuantity === "number" && body.stockQuantity > 0 && body.stockQuantity <= 100
        ? body.stockQuantity
        : null,
    times: Array.isArray(body.times)
      ? [...new Set(body.times.filter((t): t is string => typeof t === "string" && TIME.test(t)))].sort()
      : [],
    weekdays: Array.isArray(body.weekdays)
      ? [...new Set(body.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort()
      : [],
    isPrn,
    maxDosesPer24h: Number.isInteger(body.maxDosesPer24h) ? (body.maxDosesPer24h as number) : null,
    minIntervalHours: typeof body.minIntervalHours === "number" ? body.minIntervalHours : null,
    effectCheckMinutes: Number.isInteger(body.effectCheckMinutes) ? (body.effectCheckMinutes as number) : null,
    prnInstructions: text(body.prnInstructions, 2000),
    indication: text(body.indication, 240),
    prescribedBy: text(body.prescribedBy, 160),
    startOn: typeof body.startOn === "string" && DATE.test(body.startOn) ? body.startOn : "",
    endOn: typeof body.endOn === "string" && DATE.test(body.endOn) ? body.endOn : null,
  };
  if (!input.name) throw new ApiError("Bitte das Präparat angeben.");
  if (!input.amount) throw new ApiError("Bitte die Dosis angeben, z. B. „1 Tablette“.");
  if (!input.prescribedBy) throw new ApiError("Bitte die verordnende Ärztin oder den verordnenden Arzt angeben.");
  if (!input.startOn) throw new ApiError("Bitte ein gültiges Startdatum angeben.");
  if (input.endOn && input.endOn < input.startOn) throw new ApiError("Das Enddatum liegt vor dem Startdatum.");
  if (isPrn) {
    if (!input.maxDosesPer24h || input.maxDosesPer24h < 1 || input.maxDosesPer24h > 24)
      throw new ApiError("Für eine Reserve ist die maximale Anzahl Gaben pro 24 Stunden (1–24) erforderlich.");
    if (!input.minIntervalHours || input.minIntervalHours < 0.5 || input.minIntervalHours > 72)
      throw new ApiError("Für eine Reserve ist ein Mindestabstand zwischen 0,5 und 72 Stunden erforderlich.");
    if (!input.indication) throw new ApiError("Für eine Reserve ist die Indikation erforderlich.");
    if (input.effectCheckMinutes !== null && (input.effectCheckMinutes < 5 || input.effectCheckMinutes > 1440))
      throw new ApiError("Die Wirkungskontrolle muss zwischen 5 Minuten und 24 Stunden nach der Gabe liegen.");
    input.times = [];
    input.weekdays = [];
  } else {
    if (!input.times.length) throw new ApiError("Bitte mindestens eine Einnahmezeit angeben.");
    if (input.times.length > 12) throw new ApiError("Höchstens 12 Einnahmezeiten pro Verordnung.");
    input.maxDosesPer24h = null;
    input.minIntervalHours = null;
    input.effectCheckMinutes = null;
  }
  return input;
}

export async function medicationId({ sql, actor }: ApiContext, name: string, strength: string, form: string) {
  const existing = await sql`
    SELECT id FROM carecore_medications
    WHERE organization_id = ${actor.organizationId} AND LOWER(name) = LOWER(${name})
      AND COALESCE(strength, '') = ${strength}
    LIMIT 1`;
  if (existing[0]) {
    if (form)
      await sql`UPDATE carecore_medications SET form = ${form}, updated_at = NOW() WHERE id = ${existing[0].id} AND form IS NULL`;
    return existing[0].id as string;
  }
  const id = randomUUID();
  await sql`
    INSERT INTO carecore_medications (id, organization_id, name, active_ingredient, form, strength)
    VALUES (${id}, ${actor.organizationId}, ${name}, ${name}, ${form || null}, ${strength || null})`;
  return id;
}

// ---------------------------------------------------------------- residents

export async function listMedicationResidents({ sql, actor }: ApiContext): Promise<MedResident[]> {
  const rows = (await sql`
    SELECT r.id, r.first_name, r.last_name, r.medication_allergies,
      COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit,
      (SELECT COUNT(*)::int FROM carecore_medication_orders o WHERE o.resident_id = r.id AND o.status = 'active' AND NOT o.is_prn) AS regular_count,
      (SELECT COUNT(*)::int FROM carecore_medication_orders o WHERE o.resident_id = r.id AND o.status = 'active' AND o.is_prn) AS prn_count
    FROM carecore_residents r
    LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    WHERE r.organization_id = ${actor.organizationId} AND r.status = 'active'
    ORDER BY r.last_name, r.first_name`) as Row[];
  return rows.map((row) => {
    const name = `${row.first_name} ${row.last_name}`;
    return {
      id: String(row.id),
      name,
      initials: initials(name),
      room: String(row.room),
      careUnit: String(row.care_unit),
      allergies: (row.medication_allergies as string | null) ?? null,
      regularCount: Number(row.regular_count),
      prnCount: Number(row.prn_count),
    };
  });
}

export async function updateMedicationAllergies(ctx: ApiContext, residentId: unknown, allergies: unknown) {
  const id = await assertResident(ctx, residentId);
  const value = text(allergies, 1000);
  const before = await ctx.sql`SELECT medication_allergies FROM carecore_residents WHERE id = ${id}`;
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_residents SET medication_allergies = ${value || null}, updated_at = NOW() WHERE id = ${id}`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId: id,
      entityType: "resident",
      entityId: id,
      action: "medication_allergies_updated",
      before: (before[0] as Record<string, unknown> | undefined) ?? null,
      after: { medication_allergies: value || null },
    }),
  ]);
  return value || null;
}

// ------------------------------------------------------------------- orders

export async function listOrders(ctx: ApiContext, residentIdInput: unknown): Promise<MedOrder[]> {
  const residentId = await assertResident(ctx, residentIdInput);
  const rows = (await ctx.sql`
    SELECT o.id, o.resident_id, o.medication_id, COALESCE(m.name, 'Unbekanntes Präparat') AS name,
      COALESCE(m.strength, '') AS strength, COALESCE(m.form, '') AS form, COALESCE(m.is_controlled, FALSE) AS controlled, COALESCE(o.route, '') AS route,
      o.dosage, o.schedule, o.is_prn, COALESCE(o.prn_instructions, '') AS prn_instructions,
      COALESCE(o.indication, '') AS indication, COALESCE(o.prescribed_by, '') AS prescribed_by,
      to_char(o.start_on, 'YYYY-MM-DD') AS start_on, to_char(o.end_on, 'YYYY-MM-DD') AS end_on,
      o.status, o.updated_at, prn.last_at, COALESCE(prn.count_24h, 0) AS count_24h,
      own.quantity AS resident_stock, own.unit AS resident_unit, ward.quantity AS ward_stock, ward.unit AS ward_unit
    FROM carecore_medication_orders o
    LEFT JOIN carecore_medications m ON m.id = o.medication_id
    LEFT JOIN LATERAL (
      SELECT MAX(administered_at) AS last_at,
        COUNT(*) FILTER (WHERE administered_at > NOW() - INTERVAL '24 hours')::int AS count_24h
      FROM carecore_medication_administrations
      WHERE medication_order_id = o.id AND status = 'administered'
    ) prn ON o.is_prn
    LEFT JOIN LATERAL (
      SELECT SUM(quantity) AS quantity, MIN(unit) AS unit FROM carecore_medication_stock
      WHERE resident_id = o.resident_id AND medication_id = o.medication_id
    ) own ON o.is_prn
    LEFT JOIN LATERAL (
      SELECT SUM(st.quantity) AS quantity, MIN(st.unit) AS unit FROM carecore_medication_stock st
      WHERE st.resident_id IS NULL AND st.medication_id = o.medication_id
        AND st.care_unit_id = (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = o.resident_id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1)
    ) ward ON o.is_prn
    WHERE o.resident_id = ${residentId} AND o.status IN ('active', 'paused')
    ORDER BY o.is_prn, m.name`) as Row[];
  return rows.map((row) => {
    const dosage = (row.dosage ?? {}) as Record<string, unknown>;
    const schedule = (row.schedule ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id),
      residentId: String(row.resident_id),
      medicationId: (row.medication_id as string | null) ?? null,
      name: String(row.name),
      strength: String(row.strength),
      form: String(row.form),
      controlled: Boolean(row.controlled),
      route: String(row.route),
      amount: typeof dosage.amount === "string" ? dosage.amount : "",
      stockQuantity: num(dosage.quantity),
      times: Array.isArray(schedule.times)
        ? (schedule.times as unknown[]).filter((t): t is string => typeof t === "string")
        : [],
      weekdays: Array.isArray(schedule.weekdays)
        ? (schedule.weekdays as unknown[]).filter((d): d is number => typeof d === "number")
        : [],
      isPrn: Boolean(row.is_prn),
      maxDosesPer24h: num(dosage.maxDosesPer24h),
      minIntervalHours: num(dosage.minIntervalHours),
      effectCheckMinutes: num(dosage.effectCheckMinutes),
      prnInstructions: String(row.prn_instructions),
      indication: String(row.indication),
      prescribedBy: String(row.prescribed_by),
      startOn: (row.start_on as string | null) ?? null,
      endOn: (row.end_on as string | null) ?? null,
      status: row.status === "paused" ? "paused" : "active",
      updatedAt: iso(row.updated_at) ?? "",
      lastAdministeredAt: iso(row.last_at),
      administeredLast24h: Number(row.count_24h),
      residentStock: num(row.resident_stock),
      wardStock: num(row.ward_stock),
      stockUnit: (row.resident_unit as string | null) ?? (row.ward_unit as string | null) ?? null,
    };
  });
}

export function orderJson(input: OrderInput) {
  return {
    dosage: JSON.stringify(
      input.isPrn
        ? {
            amount: input.amount,
            quantity: input.stockQuantity,
            maxDosesPer24h: input.maxDosesPer24h,
            minIntervalHours: input.minIntervalHours,
            effectCheckMinutes: input.effectCheckMinutes,
          }
        : { amount: input.amount, quantity: input.stockQuantity },
    ),
    schedule: JSON.stringify(input.isPrn ? { type: "prn" } : { times: input.times, weekdays: input.weekdays }),
  };
}

export async function createOrder(ctx: ApiContext, residentIdInput: unknown, input: OrderInput) {
  const residentId = await assertResident(ctx, residentIdInput);
  const medId = await medicationId(ctx, input.name, input.strength, input.form);
  const { dosage, schedule } = orderJson(input);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_medication_orders (id, resident_id, medication_id, prescribed_by, indication, dosage, route, schedule, is_prn, prn_instructions, start_on, end_on, status, created_by)
      VALUES (${id}, ${residentId}, ${medId}, ${input.prescribedBy}, ${input.indication || null}, ${dosage}::jsonb, ${input.route}, ${schedule}::jsonb,
        ${input.isPrn}, ${input.prnInstructions || null}, ${input.startOn}, ${input.endOn}, 'active', ${ctx.actor.id})`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "medication_order",
      entityId: id,
      action: "created",
      after: { ...input },
    }),
  ]);
  return id;
}

export async function loadOrderForUpdate({ sql, actor }: ApiContext, orderId: unknown) {
  const id = assertUuid(orderId, "Verordnung");
  const rows = (await sql`
    SELECT o.* FROM carecore_medication_orders o
    JOIN carecore_residents r ON r.id = o.resident_id AND r.organization_id = ${actor.organizationId}
    WHERE o.id = ${id} LIMIT 1`) as Row[];
  if (!rows[0]) throw new ApiError("Verordnung nicht gefunden.", 404);
  return rows[0];
}

export async function updateOrder(ctx: ApiContext, orderId: unknown, input: OrderInput) {
  const before = await loadOrderForUpdate(ctx, orderId);
  if (before.status === "stopped" || before.status === "completed")
    throw new ApiError("Abgesetzte Verordnungen können nicht geändert werden.", 409);
  if (Boolean(before.is_prn) !== input.isPrn)
    throw new ApiError("Regel- und Reservemedikation können nicht ineinander umgewandelt werden.");
  const medId = await medicationId(ctx, input.name, input.strength, input.form);
  const { dosage, schedule } = orderJson(input);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_medication_orders SET medication_id = ${medId}, prescribed_by = ${input.prescribedBy}, indication = ${input.indication || null},
        dosage = ${dosage}::jsonb, route = ${input.route}, schedule = ${schedule}::jsonb, prn_instructions = ${input.prnInstructions || null},
        start_on = ${input.startOn}, end_on = ${input.endOn}, updated_at = NOW()
      WHERE id = ${before.id}`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId: String(before.resident_id),
      entityType: "medication_order",
      entityId: String(before.id),
      action: "updated",
      before,
      after: { ...input },
    }),
  ]);
}

export async function setOrderStatus(ctx: ApiContext, orderId: unknown, status: unknown, reason: unknown) {
  if (status !== "active" && status !== "paused" && status !== "stopped") throw new ApiError("Ungültiger Status.");
  const note = text(reason, 1000);
  if (status !== "active" && !note) throw new ApiError("Bitte einen Grund für das Pausieren oder Absetzen angeben.");
  const before = await loadOrderForUpdate(ctx, orderId);
  if (before.status === "stopped" || before.status === "completed")
    throw new ApiError("Die Verordnung ist bereits abgesetzt.", 409);
  if (before.status === status) return;
  await ctx.sql.transaction([
    ctx.sql`
    UPDATE carecore_medication_orders
    SET status = ${status}, end_on = CASE WHEN ${status} = 'stopped' THEN LEAST(COALESCE(end_on, (SELECT (NOW() AT TIME ZONE timezone)::date FROM carecore_organizations WHERE id = ${ctx.actor.organizationId})), (SELECT (NOW() AT TIME ZONE timezone)::date FROM carecore_organizations WHERE id = ${ctx.actor.organizationId})) ELSE end_on END, updated_at = NOW()
    WHERE id = ${before.id}`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId: String(before.resident_id),
      entityType: "medication_order",
      entityId: String(before.id),
      action: `status_${status}`,
      before: { status: before.status },
      after: { status, reason: note || null },
    }),
  ]);
}
