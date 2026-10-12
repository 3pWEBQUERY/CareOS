import { randomUUID } from "node:crypto";
import { readTerms } from "@/lib/settings";
import { ApiError, assertUuid, iso, num, text, type ApiContext, type Row } from "@/lib/api-context";
import {
  ADMINISTRATION_STATUSES,
  ROUNDS,
  initials,
  type AdministrationStatus,
  type RoundDose,
  type RoundKey,
} from "@/lib/medication-shared";
import { administrationWitness } from "./medication-btm";
import { DATE } from "./medication";
import { auditOrigin } from "@/lib/audit-origin";

// -------------------------------------------------------------------- round

export async function listRound(
  ctx: ApiContext,
  round: RoundKey,
  dateInput: unknown,
): Promise<{ date: string; doses: RoundDose[] }> {
  const { sql, actor } = ctx;
  const today = (
    await sql`SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS d FROM carecore_organizations WHERE id = ${actor.organizationId}`
  )[0]?.d as string;
  const date = typeof dateInput === "string" && DATE.test(dateInput) ? dateInput : today;
  const segments = JSON.stringify(
    ROUNDS[round].segments.map((s) => ({ day_offset: s.dayOffset, from_time: s.from, to_time: s.to })),
  );
  const rows = (await sql`
    SELECT o.id AS order_id, r.id AS resident_id, r.first_name, r.last_name, r.medication_allergies,
      COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit,
      TRIM(CONCAT_WS(' ', m.name, m.strength)) AS medication, COALESCE(m.is_controlled, FALSE) AS controlled, COALESCE(o.dosage->>'amount', '') AS amount, COALESCE(o.route, '') AS route,
      o.updated_at > NOW() - INTERVAL '48 hours' AS changed_recently,
      slot.scheduled_at, to_char(slot.scheduled_at AT TIME ZONE org.tz, 'HH24:MI') AS time,
      COALESCE(a.status, 'scheduled') AS status, a.administered_at, a.note, u.display_name AS administered_by
    FROM jsonb_to_recordset(${segments}::jsonb) AS seg(day_offset int, from_time text, to_time text)
    CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${actor.organizationId}) org
    CROSS JOIN LATERAL (SELECT ${date}::date + seg.day_offset AS d) day
    JOIN carecore_medication_orders o ON o.status = 'active' AND NOT o.is_prn
    JOIN carecore_residents r ON r.id = o.resident_id AND r.organization_id = ${actor.organizationId} AND r.status = 'active'
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.schedule->'times') = 'array' THEN o.schedule->'times' ELSE '[]'::jsonb END) AS t(value)
    CROSS JOIN LATERAL (SELECT CASE WHEN t.value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN t.value::time END AS tm) parsed
    CROSS JOIN LATERAL (SELECT (day.d + parsed.tm) AT TIME ZONE org.tz AS scheduled_at) slot
    LEFT JOIN carecore_medications m ON m.id = o.medication_id
    LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    LEFT JOIN carecore_medication_administrations a ON a.medication_order_id = o.id AND a.scheduled_at = slot.scheduled_at
    LEFT JOIN carecore_users u ON u.id = a.administered_by
    WHERE parsed.tm IS NOT NULL AND parsed.tm BETWEEN seg.from_time::time AND seg.to_time::time
      AND (o.start_on IS NULL OR o.start_on <= day.d) AND (o.end_on IS NULL OR o.end_on >= day.d)
      AND (jsonb_typeof(o.schedule->'weekdays') IS DISTINCT FROM 'array' OR jsonb_array_length(o.schedule->'weekdays') = 0
        OR o.schedule->'weekdays' @> to_jsonb(EXTRACT(ISODOW FROM day.d)::int))
    ORDER BY cu.name NULLS LAST, ro.name NULLS LAST, r.last_name, r.first_name, slot.scheduled_at, m.name`) as Row[];
  return {
    date,
    doses: rows.map((row) => {
      const residentName = `${row.first_name} ${row.last_name}`;
      return {
        orderId: String(row.order_id),
        residentId: String(row.resident_id),
        residentName,
        initials: initials(residentName),
        room: String(row.room),
        careUnit: String(row.care_unit),
        allergies: (row.medication_allergies as string | null) ?? null,
        medication: String(row.medication) || "Unbekanntes Präparat",
        controlled: Boolean(row.controlled),
        amount: String(row.amount),
        route: String(row.route),
        scheduledAt: iso(row.scheduled_at) ?? "",
        time: String(row.time),
        status: row.status as RoundDose["status"],
        administeredAt: iso(row.administered_at),
        administeredBy: (row.administered_by as string | null) ?? null,
        note: (row.note as string | null) ?? null,
        orderChangedRecently: Boolean(row.changed_recently),
      };
    }),
  };
}

export async function documentScheduledDose(ctx: ApiContext, body: Record<string, unknown>) {
  const orderId = assertUuid(body.orderId, "Verordnung");
  const status = body.status as AdministrationStatus;
  if (!ADMINISTRATION_STATUSES.includes(status)) throw new ApiError("Ungültiger Dokumentationsstatus.");
  const note = text(body.note, 2000);
  if (status !== "administered" && !note) throw new ApiError("Bitte eine Begründung dokumentieren.");
  const scheduledAt =
    typeof body.scheduledAt === "string" && !Number.isNaN(Date.parse(body.scheduledAt))
      ? new Date(body.scheduledAt).toISOString()
      : null;
  if (!scheduledAt) throw new ApiError("Ungültiger Zeitpunkt.");
  // The slot must be a real scheduled time of an active order of this organization.
  const valid = (await ctx.sql`
    SELECT o.id, o.resident_id, o.medication_id, o.dosage FROM carecore_medication_orders o
    JOIN carecore_residents r ON r.id = o.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
    CROSS JOIN LATERAL (SELECT (${scheduledAt}::timestamptz AT TIME ZONE org.tz) AS local) l
    WHERE o.id = ${orderId} AND o.status = 'active' AND NOT o.is_prn
      AND date_trunc('minute', ${scheduledAt}::timestamptz) = ${scheduledAt}::timestamptz
      AND ${scheduledAt}::timestamptz <= NOW() + INTERVAL '12 hours'
      AND o.schedule->'times' ? to_char(l.local, 'HH24:MI')
      AND (o.start_on IS NULL OR o.start_on <= l.local::date) AND (o.end_on IS NULL OR o.end_on >= l.local::date)
      AND (jsonb_typeof(o.schedule->'weekdays') IS DISTINCT FROM 'array' OR jsonb_array_length(o.schedule->'weekdays') = 0
        OR o.schedule->'weekdays' @> to_jsonb(EXTRACT(ISODOW FROM l.local)::int))
    LIMIT 1`) as Row[];
  if (!valid[0])
    throw new ApiError("Für diesen Zeitpunkt ist keine Gabe verordnet oder sie liegt zu weit in der Zukunft.", 409);
  const witness =
    status === "administered"
      ? await administrationWitness(ctx, (valid[0].medication_id as string | null) ?? null, body.witness)
      : null;
  const before =
    await ctx.sql`SELECT id, status, administered_at, administered_by, note FROM carecore_medication_administrations WHERE medication_order_id = ${orderId} AND scheduled_at = ${scheduledAt}`;
  // Gabe und Protokoll (mit Bewohnerbezug für die Akte) in einer Anweisung.
  const auditBefore = before[0] ? JSON.stringify({ residentId: valid[0].resident_id, ...before[0] }) : null;
  const auditAfter = JSON.stringify({
    residentId: valid[0].resident_id,
    status,
    note: note || null,
    scheduledAt,
    witness: witness?.name ?? null,
  });
  const rows = await ctx.sql`
    WITH dose AS (
      INSERT INTO carecore_medication_administrations (id, medication_order_id, resident_id, scheduled_at, administered_at, administered_by, status, note, witness_user_id)
      VALUES (${randomUUID()}, ${orderId}, ${valid[0].resident_id}, ${scheduledAt}, ${status === "administered" ? new Date().toISOString() : null}, ${ctx.actor.id}, ${status}, ${note || null}, ${witness?.id ?? null})
      ON CONFLICT (medication_order_id, scheduled_at) DO UPDATE
        SET status = EXCLUDED.status, administered_at = EXCLUDED.administered_at, administered_by = EXCLUDED.administered_by, note = EXCLUDED.note,
          witness_user_id = EXCLUDED.witness_user_id, updated_at = NOW()
      RETURNING id)
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, before_data, after_data)
    SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'medication_administration', dose.id,
      ${before[0] ? "corrected" : "documented"}, ${auditBefore}::jsonb, ${auditAfter}::jsonb
    FROM dose RETURNING entity_id AS id`;
  const quantity = num(((valid[0].dosage ?? {}) as Record<string, unknown>).quantity);
  return syncDoseStock(ctx, String(rows[0].id), valid[0], quantity, status, witness?.id ?? null);
}

// Resident-owned stock first, then the ward stock of the resident's current care unit.
export async function findStock(ctx: ApiContext, residentId: string, medId: string | null, quantity: number) {
  if (!medId) return null;
  const rows = (await ctx.sql`
    SELECT st.id FROM carecore_medication_stock st
    WHERE st.organization_id = ${ctx.actor.organizationId} AND st.medication_id = ${medId} AND st.quantity >= ${quantity}
      AND (st.resident_id = ${residentId}
        OR (st.resident_id IS NULL AND st.care_unit_id = (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1)))
    ORDER BY (st.resident_id IS NULL), st.expires_on NULLS LAST
    LIMIT 1`) as Row[];
  return rows[0] ? String(rows[0].id) : null;
}

// Keeps stock in line with a scheduled dose: deducts once when it becomes "administered"
// and books it back when it is corrected to another status. The journal rows linked to
// the administration are the source of truth, so repeated corrections never double-book.
export async function syncDoseStock(
  ctx: ApiContext,
  administrationId: string,
  order: Row,
  quantity: number | null,
  status: AdministrationStatus,
  witnessId: string | null = null,
): Promise<{ stockNote: string | null }> {
  const netRows = (await ctx.sql`
    SELECT COALESCE(SUM(delta), 0) AS net FROM carecore_medication_stock_movements WHERE administration_id = ${administrationId}`) as Row[];
  const net = Number(netRows[0].net);
  if (status === "administered" && net === 0) {
    if (!quantity)
      return { stockNote: "Keine abzubuchende Menge in der Verordnung hinterlegt – Bestand nicht abgebucht." };
    const stockId = await findStock(ctx, String(order.resident_id), order.medication_id as string | null, quantity);
    const booked = stockId
      ? ((await ctx.sql`
          WITH s AS (
            UPDATE carecore_medication_stock SET quantity = quantity - ${quantity}, updated_at = NOW()
            WHERE id = ${stockId} AND quantity >= ${quantity}
              AND (SELECT COALESCE(SUM(delta), 0) FROM carecore_medication_stock_movements WHERE administration_id = ${administrationId}) = 0
            RETURNING id, medication_id
          )
          INSERT INTO carecore_medication_stock_movements (id, organization_id, stock_id, medication_id, resident_id, administration_id, delta, reason, note, created_by, witness_user_id)
          SELECT ${randomUUID()}, ${ctx.actor.organizationId}, s.id, s.medication_id, ${order.resident_id}, ${administrationId}, ${-quantity}, 'administration', 'Regelgabe', ${ctx.actor.id}, ${witnessId}
          FROM s RETURNING id`) as Row[])
      : [];
    return { stockNote: booked[0] ? null : "Kein ausreichender Bestand – Gabe dokumentiert, Bestand nicht abgebucht." };
  }
  if (status !== "administered" && net < 0) {
    const last = (await ctx.sql`
      SELECT stock_id FROM carecore_medication_stock_movements
      WHERE administration_id = ${administrationId} AND reason = 'administration' AND stock_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`) as Row[];
    if (!last[0]) return { stockNote: "Bestandsposition nicht mehr vorhanden – Rückbuchung nicht möglich." };
    await ctx.sql`
      WITH s AS (
        UPDATE carecore_medication_stock SET quantity = quantity + ${-net}, updated_at = NOW()
        WHERE id = ${last[0].stock_id}
          AND (SELECT COALESCE(SUM(delta), 0) FROM carecore_medication_stock_movements WHERE administration_id = ${administrationId}) = ${net}
        RETURNING id, medication_id
      )
      INSERT INTO carecore_medication_stock_movements (id, organization_id, stock_id, medication_id, resident_id, administration_id, delta, reason, note, created_by)
      SELECT ${randomUUID()}, ${ctx.actor.organizationId}, s.id, s.medication_id, ${order.resident_id}, ${administrationId}, ${-net}, 'correction', 'Rückbuchung: Gabe korrigiert', ${ctx.actor.id}
      FROM s`;
  }
  return { stockNote: null };
}

// ---------------------------------------------------------------- reserves

export async function administerPrn(ctx: ApiContext, body: Record<string, unknown>) {
  const orderId = assertUuid(body.orderId, "Verordnung");
  const note = text(body.note, 2000);
  if (!note) throw new ApiError("Bitte den Anlass der Reservegabe dokumentieren, z. B. „Schmerzen NRS 5“.");
  const quantity = typeof body.quantity === "number" && body.quantity > 0 && body.quantity <= 100 ? body.quantity : 1;
  const orders = (await ctx.sql`
    SELECT o.id, o.resident_id, o.medication_id, o.dosage, o.status, (o.start_on IS NULL OR o.start_on <= org.today) AS started,
      (o.end_on IS NULL OR o.end_on >= org.today) AS not_ended
    FROM carecore_medication_orders o
    JOIN carecore_residents r ON r.id = o.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    CROSS JOIN (SELECT (NOW() AT TIME ZONE timezone)::date AS today FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
    WHERE o.id = ${orderId} AND o.is_prn LIMIT 1`) as Row[];
  const order = orders[0];
  if (!order) throw new ApiError("Reserveverordnung nicht gefunden.", 404);
  if (order.status !== "active" || !order.started || !order.not_ended)
    throw new ApiError("Die Reserveverordnung ist nicht gültig oder pausiert.", 409);
  const dosage = (order.dosage ?? {}) as Record<string, unknown>;
  const maxDoses = num(dosage.maxDosesPer24h);
  const minInterval = num(dosage.minIntervalHours);
  // Wirkungskontrolle nur, wenn die Verordnung einen Zeitpunkt vorgibt.
  const effectMinutes = num(dosage.effectCheckMinutes);
  if (!maxDoses || !minInterval)
    throw new ApiError(
      "Der Verordnung fehlen Maximaldosis oder Mindestabstand. Bitte zuerst die Verordnung ergänzen.",
      409,
    );

  const recent = (await ctx.sql`
    SELECT COUNT(*) FILTER (WHERE administered_at > NOW() - INTERVAL '24 hours')::int AS count_24h, MAX(administered_at) AS last_at,
      MAX(administered_at) + make_interval(mins => ${Math.round(minInterval * 60)}) AS next_allowed
    FROM carecore_medication_administrations WHERE medication_order_id = ${orderId} AND status = 'administered'`) as Row[];
  if (Number(recent[0].count_24h) >= maxDoses)
    throw new ApiError(
      `Maximaldosis erreicht: bereits ${recent[0].count_24h} von ${maxDoses} Gaben in 24 Stunden. Bitte ärztliche Rücksprache halten.`,
      409,
    );
  const nextAllowed = recent[0].next_allowed ? new Date(String(iso(recent[0].next_allowed))) : null;
  if (nextAllowed && nextAllowed > new Date())
    throw new ApiError(
      `Mindestabstand von ${String(minInterval).replace(".", ",")} Stunden noch nicht erreicht. Nächste Gabe frühestens ${nextAllowed.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" })} Uhr.`,
      409,
    );

  const witness = await administrationWitness(ctx, (order.medication_id as string | null) ?? null, body.witness);
  // Resident-owned stock first, then the ward stock of the resident's care unit.
  const stockId = await findStock(ctx, String(order.resident_id), order.medication_id as string | null, quantity);
  if (!stockId)
    throw new ApiError(
      `Kein ausreichender Bestand im ${(await readTerms(ctx)).prefix}- oder Stationsbestand. Bitte zuerst einen Eingang buchen.`,
      409,
    );

  // One statement so stock, administration and journal stay consistent; the limit
  // checks are repeated here to guard against simultaneous documentation.
  const administrationId = randomUUID();
  const result = (await ctx.sql`
    WITH s AS (
      UPDATE carecore_medication_stock SET quantity = quantity - ${quantity}, updated_at = NOW()
      WHERE id = ${stockId} AND quantity >= ${quantity}
        AND (SELECT COUNT(*) FROM carecore_medication_administrations WHERE medication_order_id = ${orderId} AND status = 'administered' AND administered_at > NOW() - INTERVAL '24 hours') < ${maxDoses}
        AND NOT EXISTS (SELECT 1 FROM carecore_medication_administrations WHERE medication_order_id = ${orderId} AND status = 'administered' AND administered_at > NOW() - make_interval(mins => ${Math.round(minInterval * 60)}))
      RETURNING id, medication_id
    ), a AS (
      INSERT INTO carecore_medication_administrations (id, medication_order_id, resident_id, scheduled_at, administered_at, administered_by, status, note, witness_user_id, effect_check_due_at)
      SELECT ${administrationId}, ${orderId}, ${order.resident_id}, date_trunc('second', NOW()), NOW(), ${ctx.actor.id}, 'administered', ${note}, ${witness?.id ?? null},
        CASE WHEN ${effectMinutes}::int IS NULL THEN NULL ELSE NOW() + make_interval(mins => ${effectMinutes}::int) END FROM s
      RETURNING id
    )
    , m AS (
      INSERT INTO carecore_medication_stock_movements (id, organization_id, stock_id, medication_id, resident_id, administration_id, delta, reason, note, created_by, witness_user_id)
      SELECT ${randomUUID()}, ${ctx.actor.organizationId}, s.id, s.medication_id, ${order.resident_id}, a.id, ${-quantity}, 'administration', ${note}, ${ctx.actor.id}, ${witness?.id ?? null}
      FROM s CROSS JOIN a
      RETURNING id
    )
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
    SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'medication_administration', ${administrationId}, 'prn_administered',
      ${JSON.stringify({ residentId: order.resident_id, orderId, quantity, note, witness: witness?.name ?? null })}::jsonb
    FROM m
    RETURNING id`) as Row[];
  if (!result[0])
    throw new ApiError(
      "Die Gabe wurde gerade anderweitig dokumentiert oder der Bestand hat sich geändert. Bitte neu laden.",
      409,
    );
}
