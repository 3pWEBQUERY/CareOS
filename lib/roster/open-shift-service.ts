import "server-only";
import { randomUUID } from "node:crypto";
import type { Row } from "@/lib/api-context";
import type { RosterContext } from "./context";
import { requirePermission } from "./context";
import { auditQuery, notifyAll, notificationQuery, resolveRecipients } from "./audit";
import { RosterError, conflict, forbidden, invalid, notFound } from "./errors";
import { managedUnitIds } from "./permissions";
import { acknowledgement, date, text, uuid, type Body } from "./schemas";
import { commitChanges } from "./shift-service";
import { addDays, formatDate } from "./time";

// Börse für offene Dienste: offen = Mindestbesetzung (Wohnbereich, Diensttyp, Tag) im veröffentlichten Plan
// nicht erreicht, ab heute. Mitarbeitende eines Wohnbereichs melden Interesse; die Leitung teilt zu – der Dienst
// entsteht über commitChanges (Regelprüfung, Audit, Benachrichtigung) – oder lehnt ab.

// Angezeigter Zeitraum ab heute (Tage). Nur eine Anzeigegrenze, keine fachliche Regel.
export const OPEN_SHIFT_WINDOW_DAYS = 60;

export type OpenShiftInterest = {
  id: string;
  employeeId: string;
  employee: string;
  status: "OPEN" | "ASSIGNED" | "DECLINED" | "WITHDRAWN" | "CLOSED";
  message: string | null;
  decisionComment: string | null;
  createdAt: string;
};

export type OpenShift = {
  key: string;
  unitId: string;
  unit: string;
  shiftTypeId: string;
  shiftType: string;
  code: string;
  color: string;
  startTime: string;
  endTime: string;
  date: string;
  required: number;
  staffed: number;
  open: number;
  interests: OpenShiftInterest[];
  // Nur in der Ansicht für Mitarbeitende: eigenes Interesse und ob an dem Tag schon ein Dienst besteht.
  mine: OpenShiftInterest | null;
  hasShiftThatDay: boolean;
};

const slotKey = (unitId: string, shiftTypeId: string, day: string) => `${unitId}|${shiftTypeId}|${day}`;

async function orgTimezone(ctx: RosterContext) {
  const rows = (await ctx.sql`
    SELECT timezone FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(rows[0]?.timezone ?? "Europe/Zurich");
}

async function today(ctx: RosterContext) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: await orgTimezone(ctx) }).format(new Date());
}

// Offene Dienste der Wohnbereiche (nur veröffentlichte Monate); optional nur ein Slot.
async function openSlots(
  ctx: RosterContext,
  unitIds: string[],
  from: string,
  to: string,
  only?: { unitId: string; shiftTypeId: string; date: string },
) {
  if (!unitIds.length) return [] as Row[];
  return (await ctx.sql`
    WITH days AS (
      SELECT d::date AS d FROM generate_series(${from}::date, ${to}::date, INTERVAL '1 day') AS d
      WHERE ${only?.date ?? null}::date IS NULL OR d::date = ${only?.date ?? null}::date),
    cells AS (
      SELECT u.id AS unit_id, u.name AS unit_name, t.id AS type_id, t.name AS type_name, t.code, t.color,
        t.start_time, t.end_time, t.sort_order, days.d,
        COALESCE(
          (SELECT r.min_count FROM carecore_staffing_requirements r
            WHERE r.care_unit_id = u.id AND r.shift_type_id = t.id AND r.date = days.d LIMIT 1),
          (SELECT r.min_count FROM carecore_staffing_requirements r
            WHERE r.care_unit_id = u.id AND r.shift_type_id = t.id AND r.date IS NULL
              AND r.weekday = EXTRACT(ISODOW FROM days.d)::int LIMIT 1),
          0)::int AS required,
        (SELECT COUNT(*) FROM carecore_roster_shifts s
          WHERE s.care_unit_id = u.id AND s.shift_type_id = t.id AND s.date = days.d)::int AS staffed
      FROM carecore_care_units u
      JOIN carecore_sites si ON si.id = u.site_id AND si.organization_id = ${ctx.actor.organizationId}
      CROSS JOIN days
      JOIN carecore_shift_types t ON t.organization_id = ${ctx.actor.organizationId} AND t.active AND t.category = 'WORK'
        AND (t.care_unit_id IS NULL OR t.care_unit_id = u.id)
      JOIN carecore_schedule_periods p ON p.care_unit_id = u.id AND p.status = 'PUBLISHED'
        AND p.year = EXTRACT(YEAR FROM days.d)::int AND p.month = EXTRACT(MONTH FROM days.d)::int
      WHERE u.id = ANY(${unitIds}::uuid[]) AND u.active
        AND (${only?.unitId ?? null}::uuid IS NULL OR u.id = ${only?.unitId ?? null}::uuid)
        AND (${only?.shiftTypeId ?? null}::uuid IS NULL OR t.id = ${only?.shiftTypeId ?? null}::uuid))
    SELECT unit_id, unit_name, type_id, type_name, code, color, start_time, end_time,
      to_char(d, 'YYYY-MM-DD') AS day, required, staffed
    FROM cells WHERE required > staffed
    ORDER BY d, sort_order, code, unit_name`) as Row[];
}

async function interestsFor(ctx: RosterContext, unitIds: string[], from: string, to: string) {
  if (!unitIds.length) return [] as Row[];
  return (await ctx.sql`
    SELECT i.*, to_char(i.date, 'YYYY-MM-DD') AS day, u.display_name AS employee_name
    FROM carecore_open_shift_interests i JOIN carecore_users u ON u.id = i.employee_id
    WHERE i.organization_id = ${ctx.actor.organizationId} AND i.care_unit_id = ANY(${unitIds}::uuid[])
      AND i.date BETWEEN ${from}::date AND ${to}::date
    ORDER BY i.created_at`) as Row[];
}

const mapInterest = (row: Row): OpenShiftInterest => ({
  id: String(row.id),
  employeeId: String(row.employee_id),
  employee: String(row.employee_name),
  status: row.status as OpenShiftInterest["status"],
  message: (row.message as string | null) ?? null,
  decisionComment: (row.decision_comment as string | null) ?? null,
  createdAt: new Date(String(row.created_at)).toISOString(),
});

// Leitung: offene Dienste der geleiteten Wohnbereiche mit allen offenen Interessen.
// Mitarbeitende: offene Dienste der eigenen (planbaren) Wohnbereiche, mit eigenem Interesse.
export async function listOpenShifts(ctx: RosterContext, scope: { own: boolean; unitId?: string | null }) {
  const from = await today(ctx);
  const to = addDays(from, OPEN_SHIFT_WINDOW_DAYS);
  let unitIds = scope.own ? ctx.access.memberUnitIds : managedUnitIds(ctx.access);
  if (scope.unitId) unitIds = unitIds.filter((id) => id === scope.unitId);
  const [slots, interests, ownShifts] = await Promise.all([
    openSlots(ctx, unitIds, from, to),
    interestsFor(ctx, unitIds, from, to),
    scope.own
      ? (ctx.sql`
          SELECT DISTINCT to_char(date, 'YYYY-MM-DD') AS day FROM carecore_roster_shifts
          WHERE organization_id = ${ctx.actor.organizationId} AND employee_id = ${ctx.actor.id}
            AND date BETWEEN ${from}::date AND ${to}::date` as Promise<Row[]>)
      : Promise.resolve([] as Row[]),
  ]);
  const busyDays = new Set(ownShifts.map((row) => String(row.day)));
  const bySlot = new Map<string, Row[]>();
  for (const row of interests) {
    const key = slotKey(String(row.care_unit_id), String(row.shift_type_id), String(row.day));
    bySlot.set(key, [...(bySlot.get(key) ?? []), row]);
  }
  const shifts: OpenShift[] = slots.map((row) => {
    const key = slotKey(String(row.unit_id), String(row.type_id), String(row.day));
    const slotInterests = bySlot.get(key) ?? [];
    const mine = slotInterests.filter((i) => String(i.employee_id) === ctx.actor.id).at(-1);
    return {
      key,
      unitId: String(row.unit_id),
      unit: String(row.unit_name),
      shiftTypeId: String(row.type_id),
      shiftType: String(row.type_name),
      code: String(row.code),
      color: String(row.color),
      startTime: String(row.start_time),
      endTime: String(row.end_time),
      date: String(row.day),
      required: Number(row.required),
      staffed: Number(row.staffed),
      open: Number(row.required) - Number(row.staffed),
      interests: scope.own ? [] : slotInterests.filter((i) => i.status === "OPEN").map(mapInterest),
      mine: scope.own && mine ? mapInterest(mine) : null,
      hasShiftThatDay: scope.own && busyDays.has(String(row.day)),
    };
  });
  // Eigene Interessen, deren Dienst inzwischen besetzt ist oder entschieden wurde (Verlauf für Mitarbeitende).
  const history = scope.own
    ? interests
        .filter((row) => String(row.employee_id) === ctx.actor.id && row.status !== "OPEN")
        .map((row) => ({ ...mapInterest(row), date: String(row.day), unitId: String(row.care_unit_id) }))
    : [];
  return { from, to, shifts, history };
}

async function loadInterest(ctx: RosterContext, id: string) {
  const rows = (await ctx.sql`
    SELECT i.*, to_char(i.date, 'YYYY-MM-DD') AS day, u.display_name AS employee_name, t.name AS type_name,
      t.start_time, t.end_time
    FROM carecore_open_shift_interests i
    JOIN carecore_users u ON u.id = i.employee_id
    JOIN carecore_shift_types t ON t.id = i.shift_type_id
    WHERE i.id = ${id} AND i.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw notFound("Interesse");
  return rows[0];
}

const describeSlot = (row: Row) =>
  `${String(row.type_name)} am ${formatDate(String(row.day), true)} (${String(row.start_time)}–${String(row.end_time)})`;

// Interesse an einem offenen Dienst melden (planbares Mitglied des Wohnbereichs).
export async function registerInterest(ctx: RosterContext, body: Body) {
  const unitId = uuid(body.unitId, "Wohnbereich");
  if (!ctx.access.memberUnitIds.includes(unitId)) {
    requirePermission(ctx, "dienstplan:read_own", unitId);
    throw forbidden("Interesse melden können Mitarbeitende, die in diesem Wohnbereich eingeplant werden.");
  }
  const shiftTypeId = uuid(body.shiftTypeId, "Diensttyp");
  const day = date(body.date, "Datum");
  const message = text(body.message, "Nachricht", 500);
  const from = await today(ctx);
  if (day < from) throw invalid("Der Dienst liegt in der Vergangenheit.");
  const [slot] = await openSlots(ctx, [unitId], day, day, { unitId, shiftTypeId, date: day });
  if (!slot) throw conflict("NOT_OPEN", "Dieser Dienst ist nicht (mehr) offen.");
  const id = randomUUID();
  const leads = await resolveRecipients(ctx, { leadsOf: unitId });
  const label = `${String(slot.type_name)} am ${formatDate(day, true)} (${String(slot.start_time)}–${String(slot.end_time)})`;
  try {
    await ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_open_shift_interests (id, organization_id, care_unit_id, shift_type_id, date, employee_id, message)
        VALUES (${id}, ${ctx.actor.organizationId}, ${unitId}, ${shiftTypeId}, ${day}::date, ${ctx.actor.id}, ${message})`,
      auditQuery(ctx, {
        action: "open_shift_interest",
        entityType: "open_shift_interest",
        entityId: id,
        unitId,
        after: { shiftTypeId, date: day, message },
      }),
      ...notifyAll(ctx, leads, {
        type: "OPEN_SHIFT_INTEREST",
        title: `Interesse an offenem Dienst: ${ctx.actor.display_name}`,
        message: `${ctx.actor.display_name} möchte ${label} übernehmen.${message ? ` „${message}“` : ""}`,
        entityType: "open_shift_interest",
        entityId: id,
        href: "/c/dienstplan/antraege",
      }),
    ]);
  } catch (error) {
    if (String(error).includes("carecore_open_shift_interest_one_open"))
      throw conflict("DUPLICATE", "Du hast für diesen Dienst bereits Interesse gemeldet.");
    throw error;
  }
  return { id };
}

// Eigenes, noch offenes Interesse zurückziehen.
export async function withdrawInterest(ctx: RosterContext, id: string) {
  const row = await loadInterest(ctx, id);
  if (String(row.employee_id) !== ctx.actor.id) throw forbidden("Nur die meldende Person kann zurückziehen.");
  if (row.status !== "OPEN") throw conflict("NOT_OPEN", "Das Interesse ist bereits entschieden.");
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_open_shift_interests SET status = 'WITHDRAWN', decided_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND status = 'OPEN'`,
    auditQuery(ctx, {
      action: "open_shift_withdrawn",
      entityType: "open_shift_interest",
      entityId: id,
      unitId: String(row.care_unit_id),
    }),
  ]);
}

// Leitung: zuteilen (Dienst anlegen, mit Regelprüfung) oder ablehnen.
export async function decideInterest(ctx: RosterContext, id: string, body: Body) {
  const row = await loadInterest(ctx, id);
  const unitId = String(row.care_unit_id);
  requirePermission(ctx, "dienstplan:create", unitId);
  if (row.status !== "OPEN") throw conflict("NOT_OPEN", "Das Interesse ist bereits entschieden.");
  const comment = text(body.comment, "Kommentar", 500);
  const day = String(row.day);
  const label = describeSlot(row);

  if (body.decision === "DECLINED") {
    await ctx.sql.transaction([
      ctx.sql`
        UPDATE carecore_open_shift_interests SET status = 'DECLINED', decision_comment = ${comment}, decided_at = NOW(),
          decided_by = ${ctx.actor.id}, updated_at = NOW()
        WHERE id = ${id} AND status = 'OPEN'`,
      auditQuery(ctx, {
        action: "open_shift_declined",
        entityType: "open_shift_interest",
        entityId: id,
        unitId,
        reason: comment,
      }),
      notificationQuery(ctx, {
        userId: String(row.employee_id),
        type: "OPEN_SHIFT_DECLINED",
        title: `Offener Dienst: nicht zugeteilt`,
        message: `${label} wurde dir nicht zugeteilt.${comment ? ` ${comment}` : ""}`,
        entityType: "open_shift_interest",
        entityId: id,
        href: "/c/mein-dienstplan/antraege",
      }),
    ]);
    return { status: "DECLINED" as const };
  }
  if (body.decision !== "ASSIGNED") throw invalid("Bitte zuteilen oder ablehnen.");

  const [slot] = await openSlots(ctx, [unitId], day, day, {
    unitId,
    shiftTypeId: String(row.shift_type_id),
    date: day,
  });
  if (!slot) throw conflict("NOT_OPEN", "Dieser Dienst ist inzwischen besetzt.");
  const lastSeat = Number(slot.required) - Number(slot.staffed) === 1;
  const others = lastSeat
    ? ((await ctx.sql`
        SELECT id, employee_id FROM carecore_open_shift_interests
        WHERE care_unit_id = ${unitId} AND shift_type_id = ${String(row.shift_type_id)} AND date = ${day}::date
          AND status = 'OPEN' AND id <> ${id}`) as Row[])
    : [];
  const shiftId = randomUUID();
  const { acknowledged, reason } = acknowledgement(body);
  const result = await commitChanges(ctx, {
    unitId,
    acknowledged,
    reason: reason ?? (comment ? `Offener Dienst: ${comment}` : "Offener Dienst zugeteilt"),
    source: "MANUAL",
    changes: [
      {
        kind: "create",
        shift: {
          id: shiftId,
          unitId,
          employeeId: String(row.employee_id),
          shiftTypeId: String(row.shift_type_id),
          date: day,
          notes: null,
        },
      },
    ],
    // Zuteilung, Schliessen der übrigen Interessen (letzter freier Platz) und Benachrichtigungen gemeinsam.
    extra: () => [
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_open_shift_interests SET status = 'ASSIGNED', roster_shift_id = ${shiftId},
            decision_comment = ${comment}, decided_at = NOW(), decided_by = ${ctx.actor.id}, updated_at = NOW()
          WHERE id = ${id} AND status = 'OPEN' RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'STALE_VERSION')`,
      auditQuery(ctx, {
        action: "open_shift_assigned",
        entityType: "open_shift_interest",
        entityId: id,
        unitId,
        after: { shiftId, employeeId: row.employee_id, date: day },
        reason: comment,
      }),
      ...(others.length
        ? [
            ctx.sql`
              UPDATE carecore_open_shift_interests SET status = 'CLOSED', decided_at = NOW(), decided_by = ${ctx.actor.id},
                updated_at = NOW()
              WHERE id = ANY(${others.map((o) => String(o.id))}::uuid[]) AND status = 'OPEN'`,
            ...others.map((other) =>
              notificationQuery(ctx, {
                userId: String(other.employee_id),
                type: "OPEN_SHIFT_CLOSED",
                title: "Offener Dienst ist besetzt",
                message: `${label} wurde inzwischen besetzt. Danke für dein Interesse.`,
                entityType: "open_shift_interest",
                entityId: String(other.id),
                href: "/c/mein-dienstplan/antraege",
              }),
            ),
          ]
        : []),
    ],
  });
  if (!result.shiftIds.includes(shiftId)) throw new RosterError("INTERNAL", "Der Dienst wurde nicht angelegt.", 500);
  return { status: "ASSIGNED" as const, shiftId, violations: result.violations };
}
