import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { activityLeaders } from "@/lib/activity-leaders";
import { hasPermission } from "@/lib/server-data";
import { parseMonth } from "@/lib/services-shared";
import {
  ACTIVITY_CATEGORIES,
  MAX_REPEAT_WEEKS,
  PARTICIPATION_STATUS,
  emptyCounts,
  type Activity,
  type ActivityDetail,
  type ActivityReport,
  type ActivityReportResident,
  type ActivityWeek,
  type ParticipationStatus,
} from "@/lib/activities-shared";

// Alltagsgestaltung und Aktivierung: Angebote planen und die Teilnahme je Person dokumentieren. Keine Vorgaben, wie viel
// Aktivierung eine Person braucht – die Übersicht zählt nur, was erfasst ist.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "documentation.write")) throw new ApiError("Keine Berechtigung.", 403);
}

const isCategory = (value: unknown): value is string =>
  typeof value === "string" && (ACTIVITY_CATEGORIES as readonly string[]).includes(value);

async function assertCareUnit(ctx: ApiContext, value: unknown) {
  if (!value) return null;
  const id = assertUuid(value, "Wohnbereich");
  const rows = await ctx.sql`
    SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
    WHERE cu.id = ${id} AND s.organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  return id;
}

const activity = (row: Row): Activity => ({
  id: String(row.id),
  seriesId: (row.series_id as string | null) ?? null,
  careUnitId: (row.care_unit_id as string | null) ?? null,
  careUnit: (row.care_unit as string | null) ?? null,
  title: String(row.title),
  category: String(row.category),
  description: String(row.description ?? ""),
  location: String(row.location ?? ""),
  leader: String(row.leader ?? ""),
  startsAt: iso(row.starts_at) ?? "",
  durationMinutes: Number(row.duration_minutes),
  started: Boolean(row.started),
  cancelledAt: iso(row.cancelled_at),
  cancelReason: String(row.cancel_reason ?? ""),
  counts: {
    participated: Number(row.participated ?? 0),
    declined: Number(row.declined ?? 0),
    absent: Number(row.absent ?? 0),
  },
});

// Woche (Montag bis Sonntag) mit den Angeboten des Wohnbereichs und des ganzen Hauses.
export async function activityWeek(
  ctx: ApiContext,
  dayInput: unknown,
  careUnitInput: string | null,
): Promise<ActivityWeek> {
  const careUnitId = careUnitInput ? assertUuid(careUnitInput, "Wohnbereich") : null;
  const day = typeof dayInput === "string" && DATE.test(dayInput) ? dayInput : null;
  const org = ctx.actor.organizationId;
  const [range] = (await ctx.sql`
    SELECT date_trunc('week', COALESCE(${day}::date, (NOW() AT TIME ZONE timezone)::date))::date::text AS from_day,
      (date_trunc('week', COALESCE(${day}::date, (NOW() AT TIME ZONE timezone)::date))::date + 7)::text AS to_day
    FROM carecore_organizations WHERE id = ${org}`) as Row[];
  const rows = (await ctx.sql`
    SELECT a.*, cu.name AS care_unit, (a.starts_at <= NOW() + INTERVAL '15 minutes') AS started,
      (SELECT COUNT(*) FROM carecore_activity_participations p WHERE p.activity_id = a.id AND p.status = 'participated') AS participated,
      (SELECT COUNT(*) FROM carecore_activity_participations p WHERE p.activity_id = a.id AND p.status = 'declined') AS declined,
      (SELECT COUNT(*) FROM carecore_activity_participations p WHERE p.activity_id = a.id AND p.status = 'absent') AS absent
    FROM carecore_activities a
    JOIN carecore_organizations o ON o.id = a.organization_id
    LEFT JOIN carecore_care_units cu ON cu.id = a.care_unit_id
    WHERE a.organization_id = ${org}
      AND a.starts_at >= (${range.from_day}::date)::timestamp AT TIME ZONE o.timezone
      AND a.starts_at < (${range.to_day}::date)::timestamp AT TIME ZONE o.timezone
      AND (${careUnitId}::uuid IS NULL OR a.care_unit_id IS NULL OR a.care_unit_id = ${careUnitId}::uuid)
    ORDER BY a.starts_at, a.title`) as Row[];
  return {
    from: String(range.from_day),
    to: String(range.to_day),
    careUnitId,
    canWrite: hasPermission(ctx.actor, "documentation.write"),
    activities: rows.map(activity),
    leaders: (await activityLeaders(ctx)).map((person) => person.name),
  };
}

async function loadActivity(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Angebot");
  const rows = (await ctx.sql`
    SELECT a.*, cu.name AS care_unit, (a.starts_at <= NOW() + INTERVAL '15 minutes') AS started
    FROM carecore_activities a LEFT JOIN carecore_care_units cu ON cu.id = a.care_unit_id
    WHERE a.id = ${id} AND a.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Angebot nicht gefunden.", 404);
  return rows[0];
}

// Angebot mit allen Personen des Wohnbereichs (bzw. des Hauses) und der erfassten Teilnahme.
export async function activityDetail(ctx: ApiContext, idInput: unknown): Promise<ActivityDetail> {
  const row = await loadActivity(ctx, idInput);
  const careUnitId = (row.care_unit_id as string | null) ?? null;
  const people = (await ctx.sql`
    SELECT r.id, r.first_name || ' ' || r.last_name AS name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit,
      p.status, COALESCE(p.note, '') AS note
    FROM carecore_residents r
    LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
    LEFT JOIN carecore_activity_participations p ON p.activity_id = ${row.id} AND p.resident_id = r.id
    WHERE r.organization_id = ${ctx.actor.organizationId}
      AND (p.status IS NOT NULL OR (r.status = 'active' AND stay.care_unit_id IS NOT NULL
        AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)))
    ORDER BY cu.name, r.last_name, r.first_name`) as Row[];
  const counts = emptyCounts();
  for (const person of people) if (person.status) counts[person.status as ParticipationStatus] += 1;
  return {
    activity: { ...activity(row), counts },
    participants: people.map((person) => ({
      residentId: String(person.id),
      name: String(person.name),
      room: String(person.room),
      careUnit: String(person.care_unit),
      status: (person.status as ParticipationStatus | null) ?? null,
      note: String(person.note),
    })),
  };
}

function activityInput(body: Record<string, unknown>) {
  const title = text(body.title, 160);
  if (!title) throw new ApiError("Bitte das Angebot bezeichnen.");
  if (!isCategory(body.category)) throw new ApiError("Bitte eine Kategorie wählen.");
  const startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) throw new ApiError("Bitte Datum und Uhrzeit angeben.");
  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 600)
    throw new ApiError("Dauer: bitte ganze Minuten zwischen 5 und 600 angeben.");
  return {
    title,
    category: body.category,
    description: text(body.description, 2000),
    location: text(body.location, 160),
    leader: text(body.leader, 160),
    startsAt,
    durationMinutes,
  };
}

// Leitung nur aus den zugeteilten Personen; ein früher erfasster Wert bleibt gültig, solange er unverändert ist.
async function assertLeader(ctx: ApiContext, leader: string, previous: string | null) {
  if (!leader || leader === previous) return;
  if (!(await activityLeaders(ctx)).some((person) => person.name === leader))
    throw new ApiError("Bitte die Leitung aus der Liste wählen. Die Zuteilung legt die Administration fest.");
}

// Angebot planen, auf Wunsch wöchentlich wiederholt (höchstens zwölf Wochen).
export async function createActivity(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const input = activityInput(body);
  await assertLeader(ctx, input.leader, null);
  const careUnitId = await assertCareUnit(ctx, body.careUnitId);
  const weeks = body.repeatWeeks === undefined || body.repeatWeeks === null ? 1 : Number(body.repeatWeeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_REPEAT_WEEKS)
    throw new ApiError(`Wiederholung: 1 bis ${MAX_REPEAT_WEEKS} Wochen.`);
  const seriesId = weeks > 1 ? randomUUID() : null;
  const ids = Array.from({ length: weeks }, () => randomUUID());
  await ctx.sql.transaction([
    ...ids.map(
      (id, week) => ctx.sql`
        INSERT INTO carecore_activities (id, organization_id, care_unit_id, series_id, title, category, description, location,
          leader, starts_at, duration_minutes, created_by)
        VALUES (${id}, ${ctx.actor.organizationId}, ${careUnitId}, ${seriesId}, ${input.title}, ${input.category},
          ${input.description}, ${input.location}, ${input.leader},
          (${input.startsAt.toISOString()}::timestamptz + make_interval(weeks => ${week})), ${input.durationMinutes},
          ${ctx.actor.id})`,
    ),
    auditStatement(ctx, "activity", ids[0], "created", null, {
      ...input,
      startsAt: input.startsAt.toISOString(),
      careUnitId,
      repeatWeeks: weeks,
    }),
  ]);
  return { ids };
}

export async function updateActivity(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await loadActivity(ctx, idInput);
  if (before.cancelled_at) throw new ApiError("Das Angebot ist abgesagt.", 409);
  const input = activityInput(body);
  await assertLeader(ctx, input.leader, String(before.leader ?? ""));
  const careUnitId = await assertCareUnit(ctx, body.careUnitId);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_activities SET title = ${input.title}, category = ${input.category}, description = ${input.description},
        location = ${input.location}, leader = ${input.leader}, starts_at = ${input.startsAt.toISOString()},
        duration_minutes = ${input.durationMinutes}, care_unit_id = ${careUnitId}, updated_at = NOW()
      WHERE id = ${before.id}`,
    auditStatement(
      ctx,
      "activity",
      String(before.id),
      "updated",
      {
        title: before.title,
        category: before.category,
        location: before.location,
        leader: before.leader,
        startsAt: iso(before.starts_at),
        durationMinutes: Number(before.duration_minutes),
        careUnitId: before.care_unit_id,
      },
      { ...input, startsAt: input.startsAt.toISOString(), careUnitId },
    ),
  ]);
}

export async function cancelActivity(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await loadActivity(ctx, idInput);
  const reason = text(body.reason, 1000);
  if (!reason) throw new ApiError("Bitte einen Grund für die Absage angeben.");
  if (before.cancelled_at) throw new ApiError("Das Angebot ist bereits abgesagt.", 409);
  try {
    await ctx.sql.transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_activities SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id},
          cancel_reason = ${reason}, updated_at = NOW()
        WHERE id = ${before.id} AND cancelled_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ACTIVITY_CANCELLED')`,
      auditStatement(
        ctx,
        "activity",
        String(before.id),
        "cancelled",
        { title: before.title },
        { title: before.title, reason },
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("ACTIVITY_CANCELLED"))
      throw new ApiError("Das Angebot ist bereits abgesagt.", 409);
    throw error;
  }
}

// Teilnahme erfassen: Status je Person (leer = nicht erfasst) mit Bemerkung; jede Änderung im Protokoll der Akte.
export async function recordParticipation(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const detail = await activityDetail(ctx, idInput);
  if (detail.activity.cancelledAt) throw new ApiError("Das Angebot ist abgesagt.", 409);
  if (!detail.activity.started) throw new ApiError("Die Teilnahme kann ab Beginn des Angebots erfasst werden.");
  if (!Array.isArray(body.entries)) throw new ApiError("Keine Angaben zur Teilnahme.");
  const known = new Map(detail.participants.map((person) => [person.residentId, person]));
  const statements = [];
  for (const raw of body.entries as Array<Record<string, unknown>>) {
    const residentId = assertUuid(raw?.residentId, "Person");
    const before = known.get(residentId);
    if (!before) throw new ApiError("Person gehört nicht zu diesem Angebot.", 404);
    const status = raw.status === null || raw.status === "" ? null : (String(raw.status) as ParticipationStatus);
    if (status !== null && !(status in PARTICIPATION_STATUS)) throw new ApiError("Teilnahme ist ungültig.");
    const note = status ? text(raw.note, 1000) : "";
    if (before.status === status && before.note === note) continue;
    statements.push(
      status
        ? ctx.sql`
            INSERT INTO carecore_activity_participations (activity_id, resident_id, status, note, recorded_by)
            VALUES (${detail.activity.id}, ${residentId}, ${status}, ${note}, ${ctx.actor.id})
            ON CONFLICT (activity_id, resident_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note,
              recorded_by = EXCLUDED.recorded_by, recorded_at = NOW()`
        : ctx.sql`
            DELETE FROM carecore_activity_participations
            WHERE activity_id = ${detail.activity.id} AND resident_id = ${residentId}`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "activity_participation",
        entityId: detail.activity.id,
        action: status ? "recorded" : "removed",
        before: before.status ? { title: detail.activity.title, status: before.status, note: before.note } : null,
        after: { title: detail.activity.title, status, note },
      }),
    );
  }
  if (statements.length) await ctx.sql.transaction(statements);
  return { changed: statements.length / 2 };
}

// Monatsübersicht: Teilnahme je Person (alle Personen des Bereichs, auch ohne Teilnahme) und Angebote im Monat.
export async function activityReport(
  ctx: ApiContext,
  monthInput: unknown,
  careUnitInput: string | null,
): Promise<ActivityReport> {
  const month = parseMonth(monthInput);
  if (!month) throw new ApiError("Monat ist ungültig.");
  const careUnitId = careUnitInput ? assertUuid(careUnitInput, "Wohnbereich") : null;
  const start = `${month}-01`;
  const org = ctx.actor.organizationId;
  const [people, participations, offers] = (await Promise.all([
    ctx.sql`
      SELECT r.id, r.first_name || ' ' || r.last_name AS name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit
      FROM carecore_residents r
      JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      WHERE r.organization_id = ${org} AND r.status = 'active'
        AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
      ORDER BY cu.name, r.last_name, r.first_name`,
    ctx.sql`
      SELECT p.resident_id, p.status, a.category, a.starts_at
      FROM carecore_activity_participations p
      JOIN carecore_activities a ON a.id = p.activity_id
      JOIN carecore_organizations o ON o.id = a.organization_id
      WHERE a.organization_id = ${org} AND a.cancelled_at IS NULL
        AND a.starts_at >= (${start}::date)::timestamp AT TIME ZONE o.timezone
        AND a.starts_at < ((${start}::date + INTERVAL '1 month')::date)::timestamp AT TIME ZONE o.timezone`,
    ctx.sql`
      SELECT COUNT(*) FILTER (WHERE a.cancelled_at IS NULL)::int AS offered,
        COUNT(*) FILTER (WHERE a.cancelled_at IS NOT NULL)::int AS cancelled
      FROM carecore_activities a JOIN carecore_organizations o ON o.id = a.organization_id
      WHERE a.organization_id = ${org}
        AND a.starts_at >= (${start}::date)::timestamp AT TIME ZONE o.timezone
        AND a.starts_at < ((${start}::date + INTERVAL '1 month')::date)::timestamp AT TIME ZONE o.timezone
        AND (${careUnitId}::uuid IS NULL OR a.care_unit_id IS NULL OR a.care_unit_id = ${careUnitId}::uuid)`,
  ])) as Row[][];
  const residents = new Map<string, ActivityReportResident>(
    people.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        name: String(row.name),
        room: String(row.room),
        careUnit: String(row.care_unit),
        counts: emptyCounts(),
        byCategory: {},
        lastParticipation: null,
      },
    ]),
  );
  const used = new Set<string>();
  for (const row of participations) {
    const entry = residents.get(String(row.resident_id));
    if (!entry) continue;
    const status = row.status as ParticipationStatus;
    entry.counts[status] += 1;
    if (status !== "participated") continue;
    const category = String(row.category);
    entry.byCategory[category] = (entry.byCategory[category] ?? 0) + 1;
    used.add(category);
    const at = iso(row.starts_at) ?? "";
    if (!entry.lastParticipation || at > entry.lastParticipation) entry.lastParticipation = at;
  }
  const order = [...ACTIVITY_CATEGORIES] as string[];
  return {
    month,
    careUnitId,
    offered: Number(offers[0]?.offered ?? 0),
    cancelled: Number(offers[0]?.cancelled ?? 0),
    categories: [...used].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    residents: [...residents.values()],
  };
}
