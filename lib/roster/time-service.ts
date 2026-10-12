import "server-only";
import { randomUUID } from "node:crypto";
import type { Row } from "@/lib/api-context";
import { iso } from "@/lib/api-context";
import { auditQuery, notificationQuery, notifyAll, resolveRecipients } from "./audit";
import type { RosterContext } from "./context";
import { requirePermission } from "./context";
import { loadEmployees, loadRuleSet, loadShift, loadShiftTypes, mapShift, monthRange, orgToday } from "./data";
import { RosterError, invalid, notFound } from "./errors";
import { managedUnitIds } from "./permissions";
import { instant, int, month, oneOf, optionalUuid, text, uuid, type Body } from "./schemas";
import { deviation, formatDate, formatHours, localDate, localTime } from "./time";
import type { RosterShift, TimeEntryStatus } from "./types";
import { breakShortfall, clockOutMissing, computeActualMinutes, summarizeMonth } from "./worktime";
import { loadEntries } from "./schedule";

// Zeiterfassung (Spec 8.9): Zeitstempel setzt der Server; Ist-Minuten werden serverseitig berechnet;
// fehlender Clock-out wird markiert, nie geraten; Korrekturen beantragt oder begründet, alles auditiert.

const CHECKLIST_KEYS = ["handover", "medcart", "phone"] as const;
const HANDOVER = ["complete", "partial", "pending"] as const;

async function openEntry(ctx: RosterContext, employeeId: string) {
  const rows = (await ctx.sql`
    SELECT e.*, s.planned_start, s.planned_end, s.break_minutes AS planned_break
    FROM carecore_time_entries e LEFT JOIN carecore_roster_shifts s ON s.id = e.shift_id
    WHERE e.employee_id = ${employeeId} AND e.status = 'OPEN' AND e.organization_id = ${ctx.actor.organizationId} LIMIT 1`) as Row[];
  return rows[0] ?? null;
}

async function primaryUnitOf(ctx: RosterContext) {
  const rows = (await ctx.sql`
    SELECT p.primary_care_unit_id FROM carecore_user_profiles p
    WHERE p.user_id = ${ctx.actor.id} AND p.organization_id = ${ctx.actor.organizationId}`) as Row[];
  const id = rows[0]?.primary_care_unit_id ? String(rows[0].primary_care_unit_id) : null;
  return id && ctx.access.allUnitIds.includes(id) ? id : null;
}

async function homeUnitOf(ctx: RosterContext, employeeId: string) {
  const [employee] = Object.values(await loadEmployees(ctx, [employeeId]));
  return employee?.unitIds[0] ?? null;
}

// Passender Dienst: ab "clockInEarliestMinutes" vor Beginn bis Dienstende, veröffentlicht, ohne Zeiteintrag.
async function matchingShift(ctx: RosterContext, requested: string | null, earliest: number) {
  const rows = (await ctx.sql.query(
    `SELECT s.id FROM carecore_roster_shifts s JOIN carecore_schedule_periods p ON p.id = s.period_id
     WHERE s.employee_id = $1 AND s.organization_id = $2 AND s.category <> 'ABSENCE' AND p.status = 'PUBLISHED' AND p.locked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM carecore_time_entries te WHERE te.shift_id = s.id)
       AND s.planned_start - make_interval(mins => $3) <= NOW() AND s.planned_end > NOW()
       AND ($4::uuid IS NULL OR s.id = $4::uuid)
     ORDER BY s.planned_start LIMIT 1`,
    [ctx.actor.id, ctx.actor.organizationId, earliest, requested],
  )) as Row[];
  return rows[0] ? await loadShift(ctx, String(rows[0].id)) : null;
}

export async function clockIn(ctx: RosterContext, body: Body) {
  // Eigene Arbeitszeit darf jede Person des Hauses erfassen – auch ohne planbare Zuordnung zu einem
  // Wohnbereich (z. B. Ärztin, Aushilfe, Administration). Die Zuordnung bestimmt nur den Wohnbereich.
  const home = await homeUnitOf(ctx, ctx.actor.id);
  if (home) requirePermission(ctx, "zeiterfassung:write_own", home);
  if (await openEntry(ctx, ctx.actor.id))
    throw new RosterError("ALREADY_CLOCKED_IN", "Du bist bereits eingestempelt.", 409);
  const rules = await loadRuleSet(ctx, home);
  const requested = optionalUuid(body.shiftId, "Dienst");
  const shift = await matchingShift(ctx, requested, rules.clockInEarliestMinutes);
  if (requested && !shift)
    throw invalid(
      `Für diesen Dienst ist Einstempeln nur ab ${rules.clockInEarliestMinutes} Minuten vor Beginn bis Dienstende möglich.`,
    );
  // Ohne Dienst: gewählter Wohnbereich des Hauses, sonst der planbare oder der eingetragene Stammwohnbereich.
  const chosen = optionalUuid(body.careUnitId, "Wohnbereich");
  if (chosen && !shift && !ctx.access.allUnitIds.includes(chosen)) throw notFound("Wohnbereich");
  const unitId = shift?.unitId ?? chosen ?? home ?? (await primaryUnitOf(ctx));
  const checklist = Array.isArray(body.checklist)
    ? [...new Set(body.checklist.filter((key) => CHECKLIST_KEYS.includes(key as never)))]
    : [];
  const handover = body.handoverStatus ? oneOf(body.handoverStatus, HANDOVER, "Übergabestatus") : null;
  const note = text(body.note, "Notiz", 2000);
  const id = randomUUID();
  const today = await orgToday(ctx, rules.timezone);
  const leads = shift || !unitId ? [] : await resolveRecipients(ctx, { leadsOf: unitId });
  // Der Zeitstempel ist die Serverzeit (NOW()), nie ein Wert aus dem Browser.
  await ctx.sql.transaction([
    ctx.sql`INSERT INTO carecore_time_entries (id, organization_id, employee_id, care_unit_id, shift_id, date, clock_in, source, status,
        checklist, handover_status, check_in_note, updated_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${unitId}, ${shift?.id ?? null}, ${shift?.date ?? today}, NOW(), 'CLOCK', 'OPEN',
        ${JSON.stringify(checklist)}::jsonb, ${handover}, ${note}, ${ctx.actor.id})`,
    auditQuery(ctx, {
      action: "clock_in",
      entityType: "time_entry",
      entityId: id,
      unitId,
      after: { shiftId: shift?.id ?? null, employeeId: ctx.actor.id },
    }),
    ...notifyAll(ctx, leads, {
      type: "UNPLANNED_WORK",
      title: `Ungeplanter Einsatz: ${ctx.actor.display_name}`,
      message: `${ctx.actor.display_name} hat ohne geplanten Dienst eingestempelt.`,
      entityType: "time_entry",
      entityId: id,
      href: "/c/dienstplan/arbeitszeit",
    }),
  ]);
  return { id, shiftId: shift?.id ?? null, unplanned: !shift };
}

export async function toggleBreak(ctx: RosterContext, action: "start" | "end") {
  const entry = await openEntry(ctx, ctx.actor.id);
  if (!entry) throw invalid("Du bist nicht eingestempelt.");
  if (action === "start") {
    if (entry.break_started_at) throw invalid("Die Pause läuft bereits.");
    await ctx.sql`UPDATE carecore_time_entries SET break_started_at = NOW(), version = version + 1, updated_at = NOW() WHERE id = ${entry.id} AND status = 'OPEN'`;
    return { breakRunning: true };
  }
  if (!entry.break_started_at) throw invalid("Es läuft keine Pause.");
  await ctx.sql`UPDATE carecore_time_entries
    SET break_minutes = LEAST(break_minutes + GREATEST(ROUND(EXTRACT(EPOCH FROM NOW() - break_started_at) / 60), 0)::int, 600),
      break_started_at = NULL, version = version + 1, updated_at = NOW()
    WHERE id = ${entry.id} AND status = 'OPEN'`;
  return { breakRunning: false };
}

function deviationOf(shift: RosterShift | null, clockIn: string, clockOut: string, breakMinutes: number) {
  if (!shift) return null;
  return deviation(
    { start: shift.plannedStart, end: shift.plannedEnd, breakMinutes: shift.breakMinutes },
    { clockIn, clockOut, breakMinutes },
  );
}

export async function clockOut(ctx: RosterContext, body: Body) {
  const entry = await openEntry(ctx, ctx.actor.id);
  if (!entry) throw invalid("Du bist aktuell nicht eingestempelt.");
  const unitId = entry.care_unit_id ? String(entry.care_unit_id) : await homeUnitOf(ctx, ctx.actor.id);
  const rules = await loadRuleSet(ctx, unitId);
  const shift = entry.shift_id ? await loadShift(ctx, String(entry.shift_id)) : null;
  const note = text(body.note, "Notiz", 2000);
  const nowRows = (await ctx.sql`SELECT NOW() AS now`) as Row[];
  const now = iso(nowRows[0].now) ?? new Date().toISOString();
  const clockInAt = iso(entry.clock_in) ?? now;
  const runningBreak = entry.break_started_at
    ? Math.max(Math.round((Date.parse(now) - Date.parse(iso(entry.break_started_at) ?? now)) / 60_000), 0)
    : 0;
  const tracked = Number(entry.break_minutes) + runningBreak;
  // Pause: gestempelte Pause, sonst die geplante Pause des Dienstes (Spec 8.9).
  const breakMinutes = Math.min(
    tracked > 0 ? tracked : (shift?.breakMinutes ?? 0),
    Math.max(Math.round((Date.parse(now) - Date.parse(clockInAt)) / 60_000) - 1, 0),
  );
  const actual = computeActualMinutes(clockInAt, now, breakMinutes);
  const dev = deviationOf(shift, clockInAt, now, breakMinutes);
  const shortfall = breakShortfall({ clockIn: clockInAt, clockOut: now, breakMinutes }, rules);
  const leads =
    dev && Math.abs(dev.differenceMinutes) >= rules.deviationThresholdMinutes
      ? await resolveRecipients(ctx, { leadsOf: unitId })
      : [];
  await ctx.sql.transaction([
    ctx.sql`WITH changed AS (
        UPDATE carecore_time_entries SET clock_out = ${now}, break_minutes = ${breakMinutes}, break_started_at = NULL,
          actual_minutes = ${actual}, status = 'COMPLETE', check_out_note = ${note}, version = version + 1, updated_at = NOW(),
          updated_by = ${ctx.actor.id}, deviation_notified_at = ${leads.length ? now : null}
        WHERE id = ${entry.id} AND status = 'OPEN' RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ENTRY_CHANGED')`,
    auditQuery(ctx, {
      action: "clock_out",
      entityType: "time_entry",
      entityId: String(entry.id),
      unitId,
      after: {
        actualMinutes: actual,
        breakMinutes,
        differenceMinutes: dev?.differenceMinutes ?? null,
        breakShortfall: shortfall,
        employeeId: ctx.actor.id,
      },
    }),
    ...notifyAll(ctx, leads, {
      type: "TIME_DEVIATION",
      title: `Arbeitszeitabweichung: ${ctx.actor.display_name}`,
      message: `⚠️ ${ctx.actor.display_name}: ${formatHours(dev?.differenceMinutes ?? 0, true)} gegenüber Dienstplan (${formatDate(String(shift?.date ?? localDate(now, rules.timezone)))}).`,
      entityType: "time_entry",
      entityId: String(entry.id),
      href: "/c/dienstplan/arbeitszeit",
    }),
  ]);
  return {
    actualMinutes: actual,
    breakMinutes,
    differenceMinutes: dev?.differenceMinutes ?? null,
    breakShortfall: shortfall,
  };
}

// Offene Einträge nach Dienstende + Frist werden unvollständig; Person und Leitung erfahren es.
export async function checkMissingClockOuts(ctx: RosterContext) {
  const rows = (await ctx.sql`
    SELECT e.id, e.employee_id, e.care_unit_id, e.clock_in, e.status, e.clock_out, s.planned_end, to_char(e.date, 'YYYY-MM-DD') AS date, u.display_name
    FROM carecore_time_entries e LEFT JOIN carecore_roster_shifts s ON s.id = e.shift_id JOIN carecore_users u ON u.id = e.employee_id
    WHERE e.organization_id = ${ctx.actor.organizationId} AND e.status = 'OPEN' AND e.missing_notified_at IS NULL
      AND e.clock_in < NOW() - INTERVAL '2 hours'`) as Row[];
  for (const row of rows) {
    const unitId = row.care_unit_id ? String(row.care_unit_id) : null;
    const rules = await loadRuleSet(ctx, unitId);
    if (
      !clockOutMissing(
        { clockIn: iso(row.clock_in) ?? "", clockOut: null, status: row.status as TimeEntryStatus },
        iso(row.planned_end),
        rules,
        new Date().toISOString(),
      )
    )
      continue;
    const leads = unitId ? await resolveRecipients(ctx, { leadsOf: unitId, includeActor: true }) : [];
    await ctx.sql.transaction([
      ctx.sql`WITH changed AS (
          UPDATE carecore_time_entries SET status = 'INCOMPLETE', missing_notified_at = NOW(), version = version + 1, updated_at = NOW()
          WHERE id = ${row.id} AND status = 'OPEN' RETURNING id)
        SELECT COUNT(*) FROM changed`,
      auditQuery(ctx, {
        action: "incomplete",
        entityType: "time_entry",
        entityId: String(row.id),
        unitId,
        after: { status: "INCOMPLETE" },
        source: "SYSTEM",
      }),
      notificationQuery(ctx, {
        userId: String(row.employee_id),
        type: "CLOCK_OUT_MISSING",
        title: "Ausstempeln fehlt",
        message: `Für deinen Einsatz am ${formatDate(String(row.date))} fehlt das Ausstempeln. Bitte eine Korrektur beantragen.`,
        entityType: "time_entry",
        entityId: String(row.id),
        href: "/c/mein-dienstplan/zeiten",
        priority: "high",
      }),
      ...leads
        .filter((id) => id !== String(row.employee_id))
        .map((userId) =>
          notificationQuery(ctx, {
            userId,
            type: "CLOCK_OUT_MISSING",
            title: `Ausstempeln fehlt: ${row.display_name}`,
            message: `${row.display_name} hat am ${formatDate(String(row.date))} nicht ausgestempelt.`,
            entityType: "time_entry",
            entityId: String(row.id),
            href: "/c/dienstplan/arbeitszeit",
          }),
        ),
    ]);
  }
}

async function loadEntry(ctx: RosterContext, id: string) {
  const rows = (await ctx.sql`
    SELECT e.*, to_char(e.date, 'YYYY-MM-DD') AS date_text, u.display_name,
      (SELECT locked_at FROM carecore_schedule_periods p WHERE p.care_unit_id = e.care_unit_id
        AND p.year = EXTRACT(YEAR FROM e.date) AND p.month = EXTRACT(MONTH FROM e.date)) AS locked_at
    FROM carecore_time_entries e JOIN carecore_users u ON u.id = e.employee_id
    WHERE e.id = ${uuid(id, "Zeiteintrag")} AND e.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw notFound("Zeiteintrag");
  return rows[0];
}

export async function requestCorrection(ctx: RosterContext, entryId: string, body: Body) {
  const entry = await loadEntry(ctx, entryId);
  if (String(entry.employee_id) !== ctx.actor.id) throw notFound("Zeiteintrag");
  if (entry.locked_at) throw new RosterError("PERIOD_LOCKED", "Der Monat ist abgeschlossen.", 409);
  const reason = text(body.reason, "Begründung", 500, true)!;
  const clockIn = body.clockIn ? instant(body.clockIn, "Beginn") : null;
  const clockOut = body.clockOut ? instant(body.clockOut, "Ende") : null;
  const breakMinutes =
    body.breakMinutes === undefined || body.breakMinutes === null || body.breakMinutes === ""
      ? null
      : int(body.breakMinutes, "Pause", 0, 600);
  if (!clockIn && !clockOut && breakMinutes === null) throw invalid("Bitte die korrigierten Zeiten angeben.");
  const effectiveIn = clockIn ?? iso(entry.clock_in);
  const effectiveOut = clockOut ?? iso(entry.clock_out);
  if (effectiveIn && effectiveOut && Date.parse(effectiveOut) <= Date.parse(effectiveIn))
    throw invalid("Das Ende muss nach dem Beginn liegen.");
  if ((clockOut && Date.parse(clockOut) > Date.now()) || (clockIn && Date.parse(clockIn) > Date.now()))
    throw invalid("Zeiten in der Zukunft sind nicht möglich.");
  const open =
    (await ctx.sql`SELECT 1 FROM carecore_time_corrections WHERE time_entry_id = ${entry.id} AND status = 'OPEN'`) as Row[];
  if (open[0]) throw new RosterError("DUPLICATE", "Für diesen Eintrag ist bereits eine Korrektur offen.", 409);
  const id = randomUUID();
  const unitId = entry.care_unit_id ? String(entry.care_unit_id) : null;
  const leads = unitId ? await resolveRecipients(ctx, { leadsOf: unitId }) : [];
  await ctx.sql.transaction([
    ctx.sql`INSERT INTO carecore_time_corrections (id, organization_id, time_entry_id, requested_by, requested_clock_in, requested_clock_out,
        requested_break_minutes, reason)
      VALUES (${id}, ${ctx.actor.organizationId}, ${entry.id}, ${ctx.actor.id}, ${clockIn}, ${clockOut}, ${breakMinutes}, ${reason})`,
    auditQuery(ctx, {
      action: "requested",
      entityType: "time_correction",
      entityId: id,
      unitId,
      after: { clockIn, clockOut, breakMinutes, employeeId: ctx.actor.id },
      reason,
    }),
    ...notifyAll(ctx, leads, {
      type: "TIME_CORRECTION_REQUESTED",
      title: `Zeitkorrektur: ${ctx.actor.display_name}`,
      message: `${ctx.actor.display_name} beantragt eine Korrektur für ${formatDate(String(entry.date_text))}.`,
      entityType: "time_correction",
      entityId: id,
      href: "/c/dienstplan/antraege",
    }),
  ]);
  return { id };
}

async function applyEntryUpdate(
  ctx: RosterContext,
  entry: Row,
  values: { clockIn: string; clockOut: string | null; breakMinutes: number },
  extra: ReturnType<RosterContext["sql"]>[],
  reason: string,
  source: "CORRECTION" | "MANUAL",
) {
  const status = values.clockOut ? "COMPLETE" : "INCOMPLETE";
  const actual = values.clockOut ? computeActualMinutes(values.clockIn, values.clockOut, values.breakMinutes) : null;
  await ctx.sql.transaction([
    ctx.sql`WITH changed AS (
        UPDATE carecore_time_entries SET clock_in = ${values.clockIn}, clock_out = ${values.clockOut}, break_minutes = ${values.breakMinutes},
          break_started_at = NULL, actual_minutes = ${actual}, status = ${status}, source = ${source}, version = version + 1,
          updated_at = NOW(), updated_by = ${ctx.actor.id}
        WHERE id = ${entry.id} AND version = ${Number(entry.version)} RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ENTRY_CHANGED')`,
    auditQuery(ctx, {
      action: "corrected",
      entityType: "time_entry",
      entityId: String(entry.id),
      unitId: entry.care_unit_id ? String(entry.care_unit_id) : null,
      before: {
        clockIn: iso(entry.clock_in),
        clockOut: iso(entry.clock_out),
        breakMinutes: Number(entry.break_minutes),
        status: entry.status,
        employeeId: String(entry.employee_id),
      },
      after: { ...values, actualMinutes: actual, status, employeeId: String(entry.employee_id) },
      reason,
    }),
    ...extra,
  ]);
}

export async function decideCorrection(ctx: RosterContext, id: string, body: Body) {
  const rows = (await ctx.sql`
    SELECT * FROM carecore_time_corrections WHERE id = ${uuid(id, "Korrektur")} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  const correction = rows[0];
  if (!correction) throw notFound("Korrektur");
  const entry = await loadEntry(ctx, String(correction.time_entry_id));
  const unitId = entry.care_unit_id ? String(entry.care_unit_id) : null;
  requirePermission(ctx, "zeiterfassung:update", unitId);
  if (correction.status !== "OPEN") throw invalid("Die Korrektur wurde bereits entschieden.");
  if (entry.locked_at) throw new RosterError("PERIOD_LOCKED", "Der Monat ist abgeschlossen.", 409);
  const decision = oneOf(body.decision, ["APPROVED", "REJECTED"] as const, "Entscheid");
  const comment = text(body.comment, "Kommentar", 500);
  const statements = [
    ctx.sql`WITH changed AS (
        UPDATE carecore_time_corrections SET status = ${decision}, decided_by = ${ctx.actor.id}, decided_at = NOW(), decision_comment = ${comment}
        WHERE id = ${correction.id} AND status = 'OPEN' RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'REQUEST_CHANGED')`,
    notificationQuery(ctx, {
      userId: String(correction.requested_by),
      type: "TIME_CORRECTION_DECIDED",
      title: decision === "APPROVED" ? "Zeitkorrektur übernommen" : "Zeitkorrektur abgelehnt",
      message: `Deine Korrektur für ${formatDate(String(entry.date_text))} wurde ${decision === "APPROVED" ? "übernommen" : "abgelehnt"}${comment ? `: ${comment}` : "."}`,
      entityType: "time_correction",
      entityId: String(correction.id),
      href: "/c/mein-dienstplan/zeiten",
    }),
  ];
  if (decision === "REJECTED") {
    await ctx.sql.transaction([
      ...statements,
      auditQuery(ctx, {
        action: "rejected",
        entityType: "time_correction",
        entityId: String(correction.id),
        unitId,
        after: { status: "REJECTED" },
        reason: comment,
      }),
    ]);
    return { status: decision };
  }
  const values = {
    clockIn: iso(correction.requested_clock_in) ?? iso(entry.clock_in)!,
    clockOut: iso(correction.requested_clock_out) ?? iso(entry.clock_out),
    breakMinutes:
      correction.requested_break_minutes === null
        ? Number(entry.break_minutes)
        : Number(correction.requested_break_minutes),
  };
  if (values.clockOut && Date.parse(values.clockOut) <= Date.parse(values.clockIn))
    throw invalid("Das Ende muss nach dem Beginn liegen.");
  await applyEntryUpdate(
    ctx,
    entry,
    values,
    statements,
    `Korrektur genehmigt: ${String(correction.reason)}${comment ? ` – ${comment}` : ""}`,
    "CORRECTION",
  );
  return { status: decision };
}

// Direkte Korrektur durch die Leitung, nur mit Begründung.
export async function updateTimeEntry(ctx: RosterContext, id: string, body: Body) {
  const entry = await loadEntry(ctx, id);
  const unitId = entry.care_unit_id ? String(entry.care_unit_id) : null;
  requirePermission(ctx, "zeiterfassung:update", unitId);
  if (entry.locked_at)
    throw new RosterError("PERIOD_LOCKED", "Der Monat ist abgeschlossen. Zuerst wieder öffnen.", 409);
  if (int(body.expectedVersion, "Version", 0, 1_000_000) !== Number(entry.version))
    throw new RosterError("STALE_VERSION", "Der Zeiteintrag wurde inzwischen geändert. Bitte neu laden.", 409);
  const reason = text(body.reason, "Begründung", 500, true)!;
  const values = {
    clockIn: body.clockIn ? instant(body.clockIn, "Beginn") : iso(entry.clock_in)!,
    clockOut: body.clockOut ? instant(body.clockOut, "Ende") : iso(entry.clock_out),
    breakMinutes:
      body.breakMinutes === undefined ? Number(entry.break_minutes) : int(body.breakMinutes, "Pause", 0, 600),
  };
  if (values.clockOut && Date.parse(values.clockOut) <= Date.parse(values.clockIn))
    throw invalid("Das Ende muss nach dem Beginn liegen.");
  const employeeId = String(entry.employee_id);
  await applyEntryUpdate(
    ctx,
    entry,
    values,
    employeeId === ctx.actor.id
      ? []
      : [
          notificationQuery(ctx, {
            userId: employeeId,
            type: "TIME_CORRECTION_DECIDED",
            title: "Zeiteintrag korrigiert",
            message: `Die Leitung hat deinen Zeiteintrag vom ${formatDate(String(entry.date_text))} korrigiert: ${reason}`,
            entityType: "time_entry",
            entityId: String(entry.id),
            href: "/c/mein-dienstplan/zeiten",
          }),
        ],
    reason,
    "MANUAL",
  );
  return { id: String(entry.id) };
}

// --- Auswertung (Spec 8.10) ----------------------------------------------------------------------

export type TimesheetRow = {
  employeeId: string;
  name: string;
  pensumPercent: number;
  targetMinutes: number;
  plannedMinutes: number;
  actualMinutes: number;
  balanceMinutes: number;
  nightMinutes: number;
  weekendMinutes: number;
  holidayMinutes: number;
  absenceDays: Record<string, number>;
  notRecorded: number;
  incomplete: number;
};

export type TimesheetEntry = {
  id: string;
  employeeId: string;
  employee: string;
  date: string;
  shift: string | null;
  planned: string | null;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  actualMinutes: number | null;
  differenceMinutes: number | null;
  startDeviationMinutes: number | null;
  endDeviationMinutes: number | null;
  status: TimeEntryStatus;
  breakShortfall: number;
  version: number;
  correction: {
    id: string;
    clockIn: string | null;
    clockOut: string | null;
    breakMinutes: number | null;
    reason: string;
  } | null;
};

export async function timesheet(ctx: RosterContext, params: URLSearchParams) {
  await checkMissingClockOuts(ctx);
  const own = params.get("eigene") === "1";
  const selected = month(params.get("monat") ?? new Date().toISOString().slice(0, 7));
  const unitId = own
    ? null
    : (optionalUuid(params.get("einheit"), "Wohnbereich") ?? managedUnitIds(ctx.access)[0] ?? null);
  if (!own) requirePermission(ctx, "zeiterfassung:read", unitId);
  const shiftTypeFilter = optionalUuid(params.get("diensttyp"), "Diensttyp");
  const personFilter = optionalUuid(params.get("person"), "Person");
  const { from, to } = monthRange(selected.year, selected.month);
  const memberIds = own
    ? [ctx.actor.id]
    : (
        (await ctx.sql`SELECT user_id FROM carecore_unit_memberships WHERE care_unit_id = ${unitId} AND plannable`) as Row[]
      ).map((r) => String(r.user_id));
  const ids = personFilter ? memberIds.filter((id) => id === personFilter) : memberIds;
  const [employees, types, rules, holidayRows, shiftRows, entries, corrections, periodRows] = await Promise.all([
    loadEmployees(ctx, ids),
    loadShiftTypes(ctx),
    loadRuleSet(ctx, unitId),
    ctx.sql`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM carecore_public_holidays WHERE organization_id = ${ctx.actor.organizationId}
      AND date BETWEEN ${from}::date AND ${to}::date` as Promise<Row[]>,
    ctx.sql.query(
      `SELECT s.id, s.period_id, s.care_unit_id, s.employee_id, s.shift_type_id, s.category, to_char(s.date, 'YYYY-MM-DD') AS date,
         s.planned_start, s.planned_end, s.break_minutes, s.source, s.notes, s.last_swap_id, s.version, FALSE AS has_time_entry
       FROM carecore_roster_shifts s JOIN carecore_schedule_periods p ON p.id = s.period_id
       WHERE s.employee_id = ANY($1::uuid[]) AND s.date BETWEEN $2::date AND $3::date AND (p.status = 'PUBLISHED' OR $4)`,
      [ids, from, to, !own],
    ) as Promise<Row[]>,
    loadEntries(ctx, ids, from, to),
    ctx.sql`SELECT c.* FROM carecore_time_corrections c JOIN carecore_time_entries e ON e.id = c.time_entry_id
      WHERE c.status = 'OPEN' AND e.employee_id = ANY(${ids}::uuid[]) AND e.date BETWEEN ${from}::date AND ${to}::date` as Promise<
      Row[]
    >,
    unitId
      ? (ctx.sql`SELECT id, status, locked_at, version FROM carecore_schedule_periods WHERE care_unit_id = ${unitId}
          AND year = ${selected.year} AND month = ${selected.month}` as Promise<Row[]>)
      : Promise.resolve([] as Row[]),
  ]);
  const shifts = shiftRows.map(mapShift).filter((s) => !shiftTypeFilter || s.shiftTypeId === shiftTypeFilter);
  const holidays = holidayRows.map((r) => String(r.d));
  const today = await orgToday(ctx, rules.timezone);
  const rows: TimesheetRow[] = Object.values(employees)
    .sort((a, b) => a.name.localeCompare(b.name, "de-CH"))
    .map((employee) => {
      const summary = summarizeMonth({
        rules,
        employee,
        year: selected.year,
        month: selected.month,
        holidays,
        shifts,
        entries,
        types,
        now: new Date().toISOString(),
        today,
      });
      return { ...summary, name: employee.name, pensumPercent: employee.pensumPercent };
    });
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const entryList: TimesheetEntry[] = entries
    .filter((e) => !shiftTypeFilter || (e.shiftId && shiftById.has(e.shiftId)))
    .sort((a, b) => b.clockIn.localeCompare(a.clockIn))
    .map((entry) => {
      const shift = entry.shiftId ? (shiftById.get(entry.shiftId) ?? null) : null;
      const dev = entry.clockOut ? deviationOf(shift, entry.clockIn, entry.clockOut, entry.breakMinutes) : null;
      const correction = corrections.find((c) => String(c.time_entry_id) === entry.id);
      return {
        id: entry.id,
        employeeId: entry.employeeId,
        employee: employees[entry.employeeId]?.name ?? "",
        date: entry.date,
        shift: shift ? (types[shift.shiftTypeId]?.name ?? "Dienst") : null,
        planned: shift
          ? `${localTime(shift.plannedStart, rules.timezone)}–${localTime(shift.plannedEnd, rules.timezone)}`
          : null,
        clockIn: entry.clockIn,
        clockOut: entry.clockOut,
        breakMinutes: entry.breakMinutes,
        actualMinutes: entry.actualMinutes,
        differenceMinutes: dev?.differenceMinutes ?? null,
        startDeviationMinutes: shift
          ? Math.round((Date.parse(entry.clockIn) - Date.parse(shift.plannedStart)) / 60_000)
          : null,
        endDeviationMinutes: dev?.endDeviationMinutes ?? null,
        status: entry.status,
        breakShortfall: breakShortfall(entry, rules),
        version: entry.version ?? 1,
        correction: correction
          ? {
              id: String(correction.id),
              clockIn: iso(correction.requested_clock_in),
              clockOut: iso(correction.requested_clock_out),
              breakMinutes:
                correction.requested_break_minutes === null ? null : Number(correction.requested_break_minutes),
              reason: String(correction.reason),
            }
          : null,
      };
    });
  const period = periodRows[0];
  return {
    year: selected.year,
    month: selected.month,
    unitId,
    timezone: rules.timezone,
    rows,
    entries: entryList,
    shiftTypes: Object.values(types).map((t) => ({ id: t.id, code: t.code, name: t.name })),
    people: Object.values(employees).map((e) => ({ id: e.id, name: e.name })),
    period: period
      ? {
          id: String(period.id),
          status: String(period.status),
          lockedAt: iso(period.locked_at),
          version: Number(period.version),
        }
      : null,
    deviationThreshold: rules.deviationThresholdMinutes,
  };
}

// Offene Korrekturanträge der geleiteten Wohnbereiche (für „Anträge“ der Leitung).
export async function openCorrections(ctx: RosterContext, unitIds: string[]) {
  if (!unitIds.length) return [];
  const rows = (await ctx.sql`
    SELECT c.id, c.reason, c.requested_clock_in, c.requested_clock_out, c.requested_break_minutes, c.created_at,
      e.clock_in, e.clock_out, e.break_minutes, to_char(e.date, 'YYYY-MM-DD') AS date, u.display_name
    FROM carecore_time_corrections c JOIN carecore_time_entries e ON e.id = c.time_entry_id JOIN carecore_users u ON u.id = e.employee_id
    WHERE c.status = 'OPEN' AND e.care_unit_id = ANY(${unitIds}::uuid[]) ORDER BY c.created_at`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    employee: String(row.display_name),
    date: String(row.date),
    reason: String(row.reason),
    current: { clockIn: iso(row.clock_in), clockOut: iso(row.clock_out), breakMinutes: Number(row.break_minutes) },
    requested: {
      clockIn: iso(row.requested_clock_in),
      clockOut: iso(row.requested_clock_out),
      breakMinutes: row.requested_break_minutes === null ? null : Number(row.requested_break_minutes),
    },
    createdAt: iso(row.created_at) ?? "",
  }));
}

export async function myCorrections(ctx: RosterContext) {
  const rows = (await ctx.sql`
    SELECT c.id, c.status, c.reason, c.decision_comment, c.created_at, to_char(e.date, 'YYYY-MM-DD') AS date
    FROM carecore_time_corrections c JOIN carecore_time_entries e ON e.id = c.time_entry_id
    WHERE c.requested_by = ${ctx.actor.id} ORDER BY c.created_at DESC LIMIT 50`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    date: String(row.date),
    status: String(row.status),
    reason: String(row.reason),
    decisionComment: row.decision_comment ? String(row.decision_comment) : null,
    createdAt: iso(row.created_at) ?? "",
  }));
}
