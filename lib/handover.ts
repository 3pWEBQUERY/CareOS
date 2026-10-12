import { randomUUID } from "node:crypto";
import {
  ApiError,
  assertResident,
  assertUuid,
  iso,
  text,
  auditStatement,
  type ApiContext,
  type Row,
} from "@/lib/api-context";
import { capturedAt, receiptStatements, withReceipt } from "@/lib/request-receipts";

export type HandoverTone = "critical" | "attention" | "info" | "stable";
export type HandoverSource = "documentation" | "vitals" | "medication" | "wounds" | "assessments" | "nutrition";

export type HandoverEvent = {
  id: string;
  source: HandoverSource;
  occurredAt: string;
  residentId: string;
  residentName: string;
  room: string;
  title: string;
  detail: string;
  tone: HandoverTone;
  author: string | null;
  href: string;
};

export type HandoverNote = {
  id: string;
  residentId: string | null;
  residentName: string | null;
  careUnit: string | null;
  content: string;
  priority: "normal" | "high" | "critical";
  author: string | null;
  createdAt: string;
  readByMe: boolean;
  readers: string[];
};

// Start of the handover window: fixed hours back, or the end of my last shift (fallback 12 h).
async function windowStart(ctx: ApiContext, period: string | null) {
  if (period === "8" || period === "12" || period === "24" || period === "48")
    return { since: new Date(Date.now() - Number(period) * 3_600_000).toISOString(), basis: `${period} Stunden` };
  const rows = (await ctx.sql`
    SELECT GREATEST(
      (SELECT MAX(clock_out) FROM carecore_time_entries WHERE employee_id = ${ctx.actor.id} AND clock_out < NOW()),
      (SELECT MAX(s.planned_end) FROM carecore_roster_shifts s JOIN carecore_schedule_periods p ON p.id = s.period_id AND p.status = 'PUBLISHED'
        WHERE s.employee_id = ${ctx.actor.id} AND s.category <> 'ABSENCE' AND s.planned_end < NOW()
          AND NOT EXISTS (SELECT 1 FROM carecore_time_entries te WHERE te.shift_id = s.id))) AS ended`) as Row[];
  const ended = iso(rows[0]?.ended);
  return ended
    ? { since: ended, basis: "Ende deines letzten Dienstes" }
    : {
        since: new Date(Date.now() - 12 * 3_600_000).toISOString(),
        basis: "12 Stunden (kein vergangener Dienst gefunden)",
      };
}

export async function handoverData(ctx: ApiContext, params: URLSearchParams) {
  const { since, basis } = await windowStart(ctx, params.get("period"));
  const unitParam = params.get("careUnitId");
  const careUnitId = unitParam && /^[0-9a-f-]{36}$/i.test(unitParam) ? unitParam : null;
  const org = ctx.actor.organizationId;
  const [events, notes, units] = (await Promise.all([
    ctx.sql`
      WITH res AS (
        SELECT r.id, r.first_name || ' ' || r.last_name AS name, COALESCE(ro.name, '') AS room
        FROM carecore_residents r
        LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
        LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
        WHERE r.organization_id = ${org} AND r.status = 'active' AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
      )
      SELECT * FROM (
        SELECT 'doc-' || d.id AS id, 'documentation' AS source, d.occurred_at AS at, res.id AS resident_id, res.name, res.room,
          'Dokumentation · ' || d.category AS title, LEFT(d.body, 280) AS detail,
          CASE d.importance WHEN 'critical' THEN 'critical' WHEN 'important' THEN 'attention' WHEN 'observation' THEN 'attention' ELSE 'info' END AS tone,
          u.display_name AS author, '/pflegedokumentation/verlauf' AS href
        FROM carecore_documentation_entries d JOIN res ON res.id = d.resident_id LEFT JOIN carecore_users u ON u.id = d.author_user_id
        WHERE d.importance IN ('important', 'critical', 'observation', 'visit') AND d.created_at > ${since}
          AND NOT EXISTS (SELECT 1 FROM carecore_documentation_entries fix WHERE fix.amended_from_id = d.id)
        UNION ALL
        SELECT 'vital-' || m.id, 'vitals', m.measured_at, res.id, res.name, res.room,
          CASE m.status WHEN 'critical' THEN 'Kritischer Vitalwert' ELSE 'Auffälliger Vitalwert' END,
          m.metric || ' ' || REPLACE(TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM m.value::text)), '.', ',')
            || COALESCE('/' || REPLACE(TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM m.secondary_value::text)), '.', ','), '') || ' ' || m.unit || COALESCE(' · ' || m.note, ''),
          CASE m.status WHEN 'critical' THEN 'critical' ELSE 'attention' END, u.display_name, '/vitalwerte'
        FROM carecore_vital_measurements m JOIN res ON res.id = m.resident_id LEFT JOIN carecore_users u ON u.id = m.measured_by
        WHERE m.status IN ('attention', 'critical') AND m.created_at > ${since}
        UNION ALL
        SELECT 'adm-' || a.id, 'medication', COALESCE(a.administered_at, a.updated_at), res.id, res.name, res.room,
          CASE WHEN o.is_prn THEN 'Reservegabe' WHEN a.status = 'declined' THEN 'Gabe verweigert' WHEN a.status = 'omitted' THEN 'Gabe ausgelassen' ELSE 'Gabe verschoben' END,
          TRIM(CONCAT_WS(' ', med.name, med.strength)) || COALESCE(' · ' || a.note, ''),
          CASE WHEN o.is_prn THEN 'info' WHEN a.status = 'declined' THEN 'critical' ELSE 'attention' END, u.display_name,
          CASE WHEN o.is_prn THEN '/medikation/reserven' ELSE '/medikation/runde' END
        FROM carecore_medication_administrations a
        JOIN carecore_medication_orders o ON o.id = a.medication_order_id
        JOIN res ON res.id = a.resident_id
        LEFT JOIN carecore_medications med ON med.id = o.medication_id
        LEFT JOIN carecore_users u ON u.id = a.administered_by
        WHERE a.updated_at > ${since} AND (a.status IN ('declined', 'omitted', 'delayed') OR (o.is_prn AND a.status = 'administered'))
        UNION ALL
        SELECT 'order-' || o.id, 'medication', o.updated_at, res.id, res.name, res.room,
          CASE WHEN o.status = 'stopped' THEN 'Verordnung abgesetzt' WHEN o.created_at > ${since} THEN 'Neue Verordnung' WHEN o.status = 'paused' THEN 'Verordnung pausiert' ELSE 'Verordnung geändert' END,
          TRIM(CONCAT_WS(' ', med.name, med.strength)) || COALESCE(' · ' || (o.dosage->>'amount'), '') || COALESCE(' · ' || o.prescribed_by, ''),
          'attention', NULL, '/medikation'
        FROM carecore_medication_orders o JOIN res ON res.id = o.resident_id LEFT JOIN carecore_medications med ON med.id = o.medication_id
        WHERE o.updated_at > ${since}
        UNION ALL
        SELECT 'wentry-' || e.id, 'wounds', e.observed_at, res.id, res.name, res.room,
          'Wunde mit Infektionszeichen', w.title || COALESCE(' · ' || e.note, ''), 'critical', u.display_name, '/wundmanagement'
        FROM carecore_wound_entries e JOIN carecore_wounds w ON w.id = e.wound_id JOIN res ON res.id = w.resident_id
        LEFT JOIN carecore_users u ON u.id = e.author_user_id
        WHERE e.infection_signs AND e.created_at > ${since}
        UNION ALL
        SELECT 'wound-' || w.id, 'wounds', w.created_at, res.id, res.name, res.room,
          'Neue Wunde erfasst', w.title, 'attention', NULL, '/wundmanagement'
        FROM carecore_wounds w JOIN res ON res.id = w.resident_id
        WHERE w.created_at > ${since}
        UNION ALL
        SELECT 'wdue-' || w.id, 'wounds', last.due, res.id, res.name, res.room,
          'Wundversorgung überfällig', w.title, 'critical', NULL, '/wundmanagement'
        FROM carecore_wounds w JOIN res ON res.id = w.resident_id
        CROSS JOIN LATERAL (
          SELECT COALESCE(MAX(observed_at), w.discovered_at, w.created_at) + make_interval(days => w.care_interval_days) AS due
          FROM carecore_wound_entries WHERE wound_id = w.id) last
        WHERE w.status IN ('active', 'healing') AND w.care_interval_days IS NOT NULL AND last.due < NOW()
        UNION ALL
        SELECT 'ass-' || rec.id, 'assessments', rec.completed_at, res.id, res.name, res.room,
          a.name || ': hohes Risiko', COALESCE(rec.summary, '') || ' · ' || REPLACE(TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM rec.score::text)), '.', ',') || ' Punkte',
          'attention', u.display_name, '/einschaetzungen'
        FROM carecore_assessment_records rec JOIN carecore_assessments a ON a.id = rec.assessment_id JOIN res ON res.id = rec.resident_id
        LEFT JOIN carecore_users u ON u.id = rec.assessor_user_id
        WHERE rec.status = 'completed' AND rec.risk_level IN ('high', 'very_high') AND rec.completed_at > ${since}
        UNION ALL
        SELECT 'meal-' || me.id, 'nutrition', me.eaten_at, res.id, res.name, res.room,
          'Wenig gegessen · ' || me.meal, me.portion_percent || ' %' || COALESCE(' · ' || me.note, ''), 'attention', u.display_name, '/ernaehrung'
        FROM carecore_meal_entries me JOIN res ON res.id = me.resident_id LEFT JOIN carecore_users u ON u.id = me.entered_by
        WHERE me.deleted_at IS NULL AND me.portion_percent <= 25 AND me.created_at > ${since}
      ) events
      ORDER BY CASE tone WHEN 'critical' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END, at DESC
      LIMIT 200`,
    ctx.sql`
      SELECT h.id, h.resident_id, r.first_name || ' ' || r.last_name AS resident_name, cu.name AS care_unit, h.content, h.priority,
        h.created_at, u.display_name AS author,
        EXISTS (SELECT 1 FROM carecore_handover_reads hr WHERE hr.handover_id = h.id AND hr.user_id = ${ctx.actor.id}) AS read_by_me,
        COALESCE((SELECT array_agg(ru.display_name ORDER BY hr.read_at) FROM carecore_handover_reads hr JOIN carecore_users ru ON ru.id = hr.user_id WHERE hr.handover_id = h.id), '{}') AS readers
      FROM carecore_handovers h
      LEFT JOIN carecore_residents r ON r.id = h.resident_id
      LEFT JOIN carecore_care_units cu ON cu.id = h.care_unit_id
      LEFT JOIN carecore_users u ON u.id = h.author_user_id
      WHERE h.organization_id = ${org} AND h.created_at > NOW() - INTERVAL '72 hours'
        AND (${careUnitId}::uuid IS NULL OR h.care_unit_id = ${careUnitId}::uuid OR h.care_unit_id IS NULL)
      ORDER BY read_by_me, CASE h.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, h.created_at DESC`,
    ctx.sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
      WHERE si.organization_id = ${org} AND cu.active ORDER BY cu.name`,
  ])) as Row[][];
  return {
    since,
    basis,
    careUnits: units.map((u) => ({ id: String(u.id), name: String(u.name) })),
    events: events.map((row): HandoverEvent => ({
      id: String(row.id),
      source: row.source as HandoverSource,
      occurredAt: iso(row.at) ?? "",
      residentId: String(row.resident_id),
      residentName: String(row.name),
      room: String(row.room),
      title: String(row.title),
      detail: String(row.detail ?? ""),
      tone: row.tone as HandoverTone,
      author: (row.author as string | null) ?? null,
      href: String(row.href),
    })),
    notes: notes.map((row): HandoverNote => ({
      id: String(row.id),
      residentId: (row.resident_id as string | null) ?? null,
      residentName: (row.resident_name as string | null) ?? null,
      careUnit: (row.care_unit as string | null) ?? null,
      content: String(row.content),
      priority: row.priority as HandoverNote["priority"],
      author: (row.author as string | null) ?? null,
      createdAt: iso(row.created_at) ?? "",
      readByMe: Boolean(row.read_by_me),
      readers: (row.readers as string[]) ?? [],
    })),
  };
}

// Offline erfasste Punkte behalten ihren Erfassungszeitpunkt (`notedAt`); mit `requestId` wird eine wiederholte
// Anfrage nicht erneut gespeichert (Ergebnis null).
export async function createNote(ctx: ApiContext, body: Record<string, unknown>, requestId: string | null = null) {
  const notedAt = capturedAt(body.notedAt);
  const content = text(body.content, 2000);
  if (content.length < 3) throw new ApiError("Bitte den Übergabepunkt formulieren.");
  const priority = body.priority === "high" || body.priority === "critical" ? body.priority : "normal";
  const residentId = body.residentId ? await assertResident(ctx, body.residentId) : null;
  let careUnitId: string | null = null;
  if (typeof body.careUnitId === "string" && body.careUnitId) {
    careUnitId = assertUuid(body.careUnitId, "Wohnbereich");
    const unit =
      await ctx.sql`SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id WHERE cu.id = ${careUnitId} AND si.organization_id = ${ctx.actor.organizationId}`;
    if (!unit[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  } else if (residentId) {
    const stay =
      await ctx.sql`SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`;
    careUnitId = (stay[0]?.care_unit_id as string | null) ?? null;
  }
  const id = randomUUID();
  const { repeated } = await withReceipt(() =>
    ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_handovers (id, organization_id, care_unit_id, resident_id, author_user_id, content, priority, created_at)
        VALUES (${id}, ${ctx.actor.organizationId}, ${careUnitId}, ${residentId}, ${ctx.actor.id}, ${content}, ${priority},
          COALESCE(${notedAt}::timestamptz, NOW()))`,
      // The author has obviously read the own note.
      ctx.sql`INSERT INTO carecore_handover_reads (handover_id, user_id) VALUES (${id}, ${ctx.actor.id})`,
      auditStatement(ctx, "handover", id, "created", null, { residentId, careUnitId, priority }),
      ...receiptStatements(ctx, requestId),
    ]),
  );
  return repeated ? null : id;
}

export async function markRead(ctx: ApiContext, noteIdInput: unknown) {
  const id = assertUuid(noteIdInput, "Übergabepunkt");
  const rows =
    await ctx.sql`SELECT id FROM carecore_handovers WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0]) throw new ApiError("Übergabepunkt nicht gefunden.", 404);
  await ctx.sql`INSERT INTO carecore_handover_reads (handover_id, user_id) VALUES (${id}, ${ctx.actor.id}) ON CONFLICT DO NOTHING`;
}
