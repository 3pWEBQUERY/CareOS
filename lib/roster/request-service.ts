import "server-only";
import { randomUUID } from "node:crypto";
import type { Row } from "@/lib/api-context";
import { iso } from "@/lib/api-context";
import { auditQuery, notificationQuery, notifyAll, resolveRecipients } from "./audit";
import type { RosterContext } from "./context";
import { requirePermission } from "./context";
import { loadShiftTypes, loadSnapshot, orgToday, loadRuleSet } from "./data";
import { RosterError, forbidden, invalid, notFound } from "./errors";
import { isLeadOf, managedUnitIds } from "./permissions";
import {
  PREFERENCE_KINDS,
  PRIORITIES,
  EXCLUSIONS,
  bool,
  date,
  int,
  oneOf,
  optionalDate,
  optionalUuid,
  text,
  uuid,
  acknowledgement,
  type Body,
} from "./schemas";
import { commitChanges } from "./shift-service";
import { addDays, daysBetween, formatDate, weekday } from "./time";
import type { RosterShift, RuleCode, ScheduleSnapshot, ShiftChange } from "./types";

// Wunschfrei (Spec 8.6), Dienstwünsche (8.7) und Abwesenheitsanträge (bestehender Antrag,
// DECISIONS F2): Anträge, Entscheidungen, Benachrichtigungen, Audit.

const ABSENCE_REQUEST_KINDS = {
  vacation: "Ferien",
  sick: "Krankheit",
  training: "Weiterbildung",
  personal: "Persönlicher Termin",
} as const;
type AbsenceRequestKind = keyof typeof ABSENCE_REQUEST_KINDS;
const ABSENCE_TYPE_CODE: Record<AbsenceRequestKind, string> = {
  vacation: "U",
  sick: "K",
  training: "FB",
  personal: "A",
};

// Wohnbereich einer Person für Anträge: Stammwohnbereich, sonst der erste, in dem sie planbar ist.
async function homeUnit(ctx: RosterContext, userId: string): Promise<string> {
  const rows = (await ctx.sql`
    SELECT COALESCE(
      (SELECT p.primary_care_unit_id FROM carecore_user_profiles p
        JOIN carecore_unit_memberships m ON m.user_id = p.user_id AND m.care_unit_id = p.primary_care_unit_id AND m.plannable
        WHERE p.user_id = ${userId}),
      (SELECT care_unit_id FROM carecore_unit_memberships WHERE user_id = ${userId} AND plannable ORDER BY created_at LIMIT 1)) AS unit_id`) as Row[];
  if (!rows[0]?.unit_id)
    throw new RosterError("NO_UNIT", "Du bist keinem Wohnbereich zugeordnet. Bitte die Leitung kontaktieren.", 404);
  return String(rows[0].unit_id);
}

const range = (from: string, to: string) =>
  Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));

// Änderungen für Abwesenheitstage: Mo–Fr ohne Feiertage plus Tage mit geplanten Diensten. Arbeitsdienste
// ohne Zeiteintrag an diesen Tagen werden entfernt (wenn erlaubt), sonst als Konflikte gemeldet.
function absenceChanges(
  snapshot: ScheduleSnapshot,
  employeeId: string,
  fallbackUnitId: string,
  from: string,
  to: string,
  shiftTypeId: string,
  removeWork: boolean,
) {
  const holidays = new Set(snapshot.holidays);
  const own = snapshot.shifts.filter((s) => s.employeeId === employeeId && s.date >= from && s.date <= to);
  const work = own.filter((s) => s.category !== "ABSENCE");
  const conflicts = work.filter((s) => !s.hasTimeEntry);
  const changes: ShiftChange[] = [];
  for (const day of range(from, to)) {
    const dayWork = work.filter((s) => s.date === day);
    if (dayWork.some((s) => s.hasTimeEntry)) continue;
    if (own.some((s) => s.date === day && s.category === "ABSENCE")) continue;
    const planned = dayWork.length > 0;
    if (!planned && (weekday(day) > 5 || holidays.has(day))) continue;
    if (planned && !removeWork) continue;
    for (const shift of dayWork) changes.push({ kind: "delete", shiftId: shift.id, expectedVersion: shift.version });
    changes.push({
      kind: "create",
      shift: { id: randomUUID(), unitId: dayWork[0]?.unitId ?? fallbackUnitId, employeeId, shiftTypeId, date: day },
    });
  }
  return { changes, conflicts };
}

const describeShift = (snapshot: ScheduleSnapshot, shift: RosterShift) =>
  `${formatDate(shift.date)} ${snapshot.shiftTypes[shift.shiftTypeId]?.name ?? "Dienst"}`;

// --- Wunschfrei ----------------------------------------------------------------------------------

export async function createTimeOff(ctx: RosterContext, body: Body) {
  const unitId = optionalUuid(body.unitId, "Wohnbereich") ?? (await homeUnit(ctx, ctx.actor.id));
  requirePermission(ctx, "wunschfrei:create", unitId);
  const startDate = date(body.startDate, "Von");
  const endDate = body.endDate ? date(body.endDate, "Bis") : startDate;
  if (endDate < startDate) throw invalid("Das Ende liegt vor dem Beginn.");
  if (daysBetween(startDate, endDate) > 31) throw invalid("Wunschfrei umfasst höchstens 31 Tage am Stück.");
  const rules = await loadRuleSet(ctx, unitId);
  if (startDate < (await orgToday(ctx, rules.timezone)))
    throw invalid("Wunschfrei kann nur für kommende Tage beantragt werden.");
  const priority = oneOf(body.priority ?? "MEDIUM", PRIORITIES, "Priorität");
  const reason = text(body.reason, "Grund", 200);
  const comment = text(body.comment, "Kommentar", 1000);
  const overlap = (await ctx.sql`
    SELECT 1 FROM carecore_time_off_requests WHERE employee_id = ${ctx.actor.id} AND status IN ('OPEN', 'APPROVED')
      AND start_date <= ${endDate}::date AND end_date >= ${startDate}::date LIMIT 1`) as Row[];
  if (overlap[0])
    throw new RosterError("DUPLICATE", "Für diesen Zeitraum gibt es bereits einen Wunschfrei-Antrag.", 409);
  const id = randomUUID();
  const leads = await resolveRecipients(ctx, { leadsOf: unitId });
  const when =
    startDate === endDate ? formatDate(startDate, true) : `${formatDate(startDate)}–${formatDate(endDate, true)}`;
  await ctx.sql.transaction([
    ctx.sql`INSERT INTO carecore_time_off_requests (id, organization_id, employee_id, care_unit_id, start_date, end_date, priority, reason, comment)
      VALUES (${id}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${unitId}, ${startDate}, ${endDate}, ${priority}, ${reason}, ${comment})`,
    auditQuery(ctx, {
      action: "requested",
      entityType: "time_off",
      entityId: id,
      unitId,
      after: { startDate, endDate, priority, employeeId: ctx.actor.id },
    }),
    ...notifyAll(ctx, leads, {
      type: "TIME_OFF_REQUESTED",
      title: `Wunschfrei: ${ctx.actor.display_name}`,
      message: `${ctx.actor.display_name} wünscht frei am ${when} (Priorität ${priority === "HIGH" ? "hoch" : priority === "LOW" ? "niedrig" : "mittel"}).`,
      entityType: "time_off",
      entityId: id,
      href: "/c/dienstplan/antraege",
      priority: priority === "HIGH" ? "high" : "normal",
    }),
  ]);
  return { id };
}

async function loadTimeOff(ctx: RosterContext, id: string) {
  const rows = (await ctx.sql`
    SELECT t.*, to_char(t.start_date, 'YYYY-MM-DD') AS start_text, to_char(t.end_date, 'YYYY-MM-DD') AS end_text, u.display_name
    FROM carecore_time_off_requests t JOIN carecore_users u ON u.id = t.employee_id
    WHERE t.id = ${uuid(id, "Antrag")} AND t.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw notFound("Antrag");
  return rows[0];
}

export async function withdrawTimeOff(ctx: RosterContext, id: string) {
  const request = await loadTimeOff(ctx, id);
  if (String(request.employee_id) !== ctx.actor.id) throw notFound("Antrag");
  if (request.status !== "OPEN") throw invalid("Nur offene Anträge können zurückgezogen werden.");
  await ctx.sql.transaction([
    ctx.sql`WITH changed AS (UPDATE carecore_time_off_requests SET status = 'WITHDRAWN', updated_at = NOW() WHERE id = ${request.id} AND status = 'OPEN' RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'REQUEST_CHANGED')`,
    auditQuery(ctx, {
      action: "withdrawn",
      entityType: "time_off",
      entityId: String(request.id),
      unitId: String(request.care_unit_id),
      before: { status: "OPEN" },
      after: { status: "WITHDRAWN" },
    }),
  ]);
  return { id: String(request.id) };
}

// Genehmigen nur ohne Dienst an diesen Tagen – oder mit "Dienst entfernen und genehmigen" (eine Transaktion).
export async function decideTimeOff(ctx: RosterContext, id: string, body: Body) {
  const request = await loadTimeOff(ctx, id);
  const unitId = String(request.care_unit_id);
  requirePermission(ctx, "wunschfrei:decide", unitId);
  if (request.status !== "OPEN") throw invalid("Der Antrag wurde bereits entschieden.");
  const decision = oneOf(body.decision, ["APPROVED", "REJECTED"] as const, "Entscheid");
  const comment = text(body.comment, "Kommentar", 1000);
  const employeeId = String(request.employee_id);
  const from = String(request.start_text);
  const to = String(request.end_text);
  const when = from === to ? formatDate(from, true) : `${formatDate(from)}–${formatDate(to, true)}`;
  const statements = (extra: { removed: number }) => [
    ctx.sql`WITH changed AS (
        UPDATE carecore_time_off_requests SET status = ${decision}, decided_by = ${ctx.actor.id}, decided_at = NOW(),
          decision_comment = ${comment}, updated_at = NOW() WHERE id = ${request.id} AND status = 'OPEN' RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'REQUEST_CHANGED')`,
    auditQuery(ctx, {
      action: decision === "APPROVED" ? "approved" : "rejected",
      entityType: "time_off",
      entityId: String(request.id),
      unitId,
      before: { status: "OPEN" },
      after: { status: decision, removedShifts: extra.removed, employeeId },
      reason: comment,
    }),
    notificationQuery(ctx, {
      userId: employeeId,
      type: "TIME_OFF_DECIDED",
      title: decision === "APPROVED" ? "Wunschfrei genehmigt" : "Wunschfrei abgelehnt",
      message: `Dein Wunschfrei am ${when} wurde ${decision === "APPROVED" ? "genehmigt" : "abgelehnt"}${comment ? `: ${comment}` : "."}${extra.removed ? ` ${extra.removed} ${extra.removed === 1 ? "Dienst wurde" : "Dienste wurden"} entfernt.` : ""}`,
      entityType: "time_off",
      entityId: String(request.id),
      href: "/c/mein-dienstplan/antraege",
    }),
  ];
  if (decision === "REJECTED") {
    await ctx.sql.transaction(statements({ removed: 0 }));
    return { status: decision, removed: 0 };
  }
  const snapshot = await loadSnapshot(ctx, { unitId, from, to, employeeIds: [employeeId] });
  const shifts = snapshot.shifts.filter(
    (s) => s.employeeId === employeeId && s.date >= from && s.date <= to && s.category !== "ABSENCE",
  );
  if (shifts.some((s) => s.hasTimeEntry))
    throw new RosterError("SHIFT_HAS_TIME_ENTRY", "An diesen Tagen wurde bereits Arbeitszeit erfasst.", 409);
  if (shifts.length && !bool(body.removeShifts))
    throw new RosterError(
      "HAS_SHIFTS",
      `${request.display_name} ist an diesen Tagen eingeteilt: ${shifts.map((s) => describeShift(snapshot, s)).join(", ")}. Dienst entfernen und genehmigen?`,
      409,
    );
  if (!shifts.length) {
    await ctx.sql.transaction(statements({ removed: 0 }));
    return { status: decision, removed: 0 };
  }
  const { acknowledged, reason } = acknowledgement(body);
  await commitChanges(ctx, {
    unitId,
    acknowledged,
    reason: reason ?? `Wunschfrei genehmigt${comment ? `: ${comment}` : ""}`,
    source: "MANUAL",
    changes: shifts.map((s) => ({ kind: "delete" as const, shiftId: s.id, expectedVersion: s.version })),
    extra: () => statements({ removed: shifts.length }),
    notify: false,
  });
  return { status: decision, removed: shifts.length };
}

// --- Dienstwünsche -------------------------------------------------------------------------------

export async function savePreference(ctx: RosterContext, id: string | null, body: Body) {
  const unitId = await homeUnit(ctx, ctx.actor.id);
  requirePermission(ctx, "dienstwunsch:create", unitId);
  if (id) {
    const rows =
      (await ctx.sql`SELECT employee_id FROM carecore_shift_preferences WHERE id = ${uuid(id, "Dienstwunsch")} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
    if (!rows[0] || String(rows[0].employee_id) !== ctx.actor.id) throw notFound("Dienstwunsch");
  }
  const kind = oneOf(body.kind, PREFERENCE_KINDS, "Art des Wunsches");
  const types = await loadShiftTypes(ctx);
  const shiftTypeId =
    kind === "PREFER_SHIFT_TYPE" || kind === "AVOID_SHIFT_TYPE" ? uuid(body.shiftTypeId, "Diensttyp") : null;
  if (shiftTypeId && !types[shiftTypeId]) throw notFound("Diensttyp");
  const weekdayValue =
    body.weekday === null || body.weekday === undefined || body.weekday === ""
      ? null
      : int(body.weekday, "Wochentag", 1, 7);
  if ((kind === "PREFER_WEEKDAY" || kind === "AVOID_WEEKDAY") && !weekdayValue)
    throw invalid("Bitte einen Wochentag wählen.");
  const category = kind === "AVOID_CATEGORY" ? oneOf(body.category, EXCLUSIONS, "Dienstart") : null;
  const value = {
    kind,
    shiftTypeId,
    weekday: weekdayValue,
    category,
    date: optionalDate(body.date, "Datum"),
    validFrom: optionalDate(body.validFrom, "Gültig ab"),
    validUntil: optionalDate(body.validUntil, "Gültig bis"),
    comment: text(body.comment, "Kommentar", 300),
    active: body.active === undefined ? true : bool(body.active),
  };
  if (value.validFrom && value.validUntil && value.validUntil < value.validFrom)
    throw invalid("„Gültig bis“ liegt vor „Gültig ab“.");
  const preferenceId = id ?? randomUUID();
  const leads = id ? [] : await resolveRecipients(ctx, { leadsOf: unitId });
  await ctx.sql.transaction([
    id
      ? ctx.sql`UPDATE carecore_shift_preferences SET kind = ${value.kind}, shift_type_id = ${value.shiftTypeId}, weekday = ${value.weekday},
          category = ${value.category}, date = ${value.date}, valid_from = ${value.validFrom}, valid_until = ${value.validUntil},
          comment = ${value.comment}, active = ${value.active}, updated_at = NOW() WHERE id = ${id}`
      : ctx.sql`INSERT INTO carecore_shift_preferences (id, organization_id, employee_id, kind, shift_type_id, weekday, category, date,
          valid_from, valid_until, comment, active)
        VALUES (${preferenceId}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${value.kind}, ${value.shiftTypeId}, ${value.weekday},
          ${value.category}, ${value.date}, ${value.validFrom}, ${value.validUntil}, ${value.comment}, ${value.active})`,
    auditQuery(ctx, {
      action: id ? "updated" : "created",
      entityType: "preference",
      entityId: preferenceId,
      unitId,
      after: { ...value, employeeId: ctx.actor.id },
    }),
    ...notifyAll(ctx, leads, {
      type: "PREFERENCE_SUBMITTED",
      title: `Neuer Dienstwunsch: ${ctx.actor.display_name}`,
      message: `${ctx.actor.display_name} hat einen Dienstwunsch erfasst.`,
      entityType: "preference",
      entityId: preferenceId,
      href: "/c/dienstplan/antraege",
    }),
  ]);
  return { id: preferenceId };
}

export async function deletePreference(ctx: RosterContext, id: string) {
  const rows = (await ctx.sql`
    SELECT id, kind FROM carecore_shift_preferences WHERE id = ${uuid(id, "Dienstwunsch")} AND employee_id = ${ctx.actor.id}`) as Row[];
  if (!rows[0]) throw notFound("Dienstwunsch");
  await ctx.sql.transaction([
    ctx.sql`DELETE FROM carecore_shift_preferences WHERE id = ${rows[0].id} AND employee_id = ${ctx.actor.id}`,
    auditQuery(ctx, {
      action: "deleted",
      entityType: "preference",
      entityId: String(rows[0].id),
      unitId: null,
      before: rows[0],
    }),
  ]);
  return { id: String(rows[0].id) };
}

// --- Abwesenheiten (Ferien, Weiterbildung, Krankmeldung) -----------------------------------------

async function absenceTypeId(ctx: RosterContext, kind: AbsenceRequestKind) {
  const types = await loadShiftTypes(ctx);
  const type = Object.values(types).find(
    (t) => t.code === ABSENCE_TYPE_CODE[kind] && t.category === "ABSENCE" && t.active,
  );
  if (!type)
    throw invalid(
      `Für „${ABSENCE_REQUEST_KINDS[kind]}“ ist kein aktiver Abwesenheits-Diensttyp (Kürzel ${ABSENCE_TYPE_CODE[kind]}) eingerichtet.`,
    );
  return type.id;
}

// Wirkt eine Abwesenheit als Dienste aus; Krankmeldungen sofort, Anträge nach Bewilligung.
async function applyAbsence(
  ctx: RosterContext,
  input: {
    absenceId: string;
    employeeId: string;
    kind: AbsenceRequestKind;
    from: string;
    to: string;
    removeWork: boolean;
    acknowledged: RuleCode[];
    reason: string | null;
  },
  extra: () => ReturnType<RosterContext["sql"]>[],
  onBehalf: boolean,
) {
  const unitId = await homeUnit(ctx, input.employeeId);
  const snapshot = await loadSnapshot(ctx, { unitId, from: input.from, to: input.to, employeeIds: [input.employeeId] });
  const { changes, conflicts } = absenceChanges(
    snapshot,
    input.employeeId,
    unitId,
    input.from,
    input.to,
    await absenceTypeId(ctx, input.kind),
    input.removeWork,
  );
  if (conflicts.length && !input.removeWork)
    throw new RosterError(
      "HAS_SHIFTS",
      `Eingeteilte Dienste in diesem Zeitraum: ${conflicts.map((s) => describeShift(snapshot, s)).join(", ")}. Dienste entfernen und genehmigen?`,
      409,
    );
  if (!changes.length) {
    await ctx.sql.transaction(extra());
    return { created: 0, removed: 0 };
  }
  const units = [
    ...new Set([unitId, ...snapshot.shifts.filter((s) => s.employeeId === input.employeeId).map((s) => s.unitId)]),
  ];
  await commitChanges(ctx, {
    unitId,
    acknowledged: input.acknowledged,
    reason: input.reason,
    source: "MANUAL",
    changes,
    // Krankmeldungen trägt die Person selbst ein: der Scope gilt dann für ihre eigenen Wohnbereiche.
    snapshotScope: onBehalf ? (s) => ({ ...s, managedUnitIds: units }) : undefined,
    extra,
    notify: false,
  });
  return {
    created: changes.filter((c) => c.kind === "create").length,
    removed: changes.filter((c) => c.kind === "delete").length,
  };
}

export async function createAbsence(ctx: RosterContext, body: Body) {
  const kind = oneOf(body.kind, Object.keys(ABSENCE_REQUEST_KINDS) as AbsenceRequestKind[], "Art der Abwesenheit");
  const from = date(body.startsOn, "Von");
  const to = date(body.endsOn ?? body.startsOn, "Bis");
  if (to < from) throw invalid("Das Ende liegt vor dem Beginn.");
  if (daysBetween(from, to) > 366) throw invalid("Eine Abwesenheit darf höchstens ein Jahr dauern.");
  const unitId = await homeUnit(ctx, ctx.actor.id);
  requirePermission(ctx, "wunschfrei:create", unitId);
  const rules = await loadRuleSet(ctx, unitId);
  const today = await orgToday(ctx, rules.timezone);
  if (kind !== "sick" && from < today) throw invalid("Nur Krankheit kann rückwirkend gemeldet werden.");
  if (kind === "sick" && from < addDays(today, -14))
    throw invalid("Krankheit kann höchstens 14 Tage rückwirkend gemeldet werden.");
  const overlap = (await ctx.sql`
    SELECT 1 FROM carecore_absences WHERE user_id = ${ctx.actor.id} AND status IN ('requested', 'approved')
      AND starts_on <= ${to}::date AND ends_on >= ${from}::date LIMIT 1`) as Row[];
  if (overlap[0]) throw new RosterError("DUPLICATE", "Für diesen Zeitraum besteht bereits eine Abwesenheit.", 409);
  const id = randomUUID();
  const note = text(body.note, "Notiz", 1000);
  const leads = await resolveRecipients(ctx, { leadsOf: unitId });
  const when = from === to ? formatDate(from, true) : `${formatDate(from)}–${formatDate(to, true)}`;
  const statements = () => [
    ctx.sql`INSERT INTO carecore_absences (id, organization_id, user_id, kind, starts_on, ends_on, note, status, decided_at)
      VALUES (${id}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${kind}, ${from}, ${to}, ${note},
        ${kind === "sick" ? "approved" : "requested"}, ${kind === "sick" ? new Date().toISOString() : null})`,
    auditQuery(ctx, {
      action: kind === "sick" ? "reported" : "requested",
      entityType: "absence",
      entityId: id,
      unitId,
      after: { kind, from, to, employeeId: ctx.actor.id },
    }),
    ...notifyAll(ctx, leads, {
      type: kind === "sick" ? "STAFFING_PROBLEM" : "TIME_OFF_REQUESTED",
      title: `${kind === "sick" ? "Krankmeldung" : "Abwesenheitsantrag"}: ${ctx.actor.display_name}`,
      // Kolleg:innen sehen den Grund nie; die Leitung erhält die Art der Abwesenheit.
      message: `${ABSENCE_REQUEST_KINDS[kind]} ${when}${kind === "sick" ? " – eingeteilte Dienste sind entfernt, bitte Besetzung prüfen." : ""}`,
      entityType: "absence",
      entityId: id,
      href: kind === "sick" ? "/c/dienstplan" : "/c/dienstplan/antraege",
      priority: kind === "sick" ? "high" : "normal",
    }),
  ];
  if (kind === "sick")
    return applyAbsence(
      ctx,
      {
        absenceId: id,
        employeeId: ctx.actor.id,
        kind,
        from,
        to,
        removeWork: true,
        acknowledged: ["MIN_STAFFING", "MIN_QUALIFIED", "MAX_CONSECUTIVE_DAYS", "MAX_WEEKLY_WORK"],
        reason: "Krankmeldung",
      },
      statements,
      true,
    );
  await ctx.sql.transaction(statements());
  return { created: 0, removed: 0 };
}

async function loadAbsence(ctx: RosterContext, id: string) {
  const rows = (await ctx.sql`
    SELECT ab.*, to_char(ab.starts_on, 'YYYY-MM-DD') AS from_text, to_char(ab.ends_on, 'YYYY-MM-DD') AS to_text, u.display_name
    FROM carecore_absences ab JOIN carecore_users u ON u.id = ab.user_id
    WHERE ab.id = ${uuid(id, "Abwesenheit")} AND ab.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw notFound("Abwesenheit");
  return rows[0];
}

export async function decideAbsence(ctx: RosterContext, id: string, body: Body) {
  const absence = await loadAbsence(ctx, id);
  const employeeId = String(absence.user_id);
  const kind = absence.kind as AbsenceRequestKind;
  const from = String(absence.from_text);
  const to = String(absence.to_text);
  const label = `${ABSENCE_REQUEST_KINDS[kind] ?? "Abwesenheit"} ${from === to ? formatDate(from, true) : `${formatDate(from)}–${formatDate(to, true)}`}`;
  if (body.action === "withdraw") {
    if (employeeId !== ctx.actor.id) throw notFound("Abwesenheit");
    if (absence.status !== "requested") throw invalid("Nur offene Anträge können zurückgezogen werden.");
    await ctx.sql.transaction([
      ctx.sql`UPDATE carecore_absences SET status = 'withdrawn', updated_at = NOW() WHERE id = ${absence.id} AND status = 'requested'`,
      auditQuery(ctx, {
        action: "withdrawn",
        entityType: "absence",
        entityId: String(absence.id),
        unitId: null,
        before: { status: "requested" },
        after: { status: "withdrawn" },
      }),
    ]);
    return { status: "withdrawn" };
  }
  const unitId = await homeUnit(ctx, employeeId);
  requirePermission(ctx, "wunschfrei:decide", unitId);
  if (absence.status !== "requested") throw invalid("Der Antrag wurde bereits entschieden.");
  const decision = oneOf(body.decision, ["APPROVED", "REJECTED"] as const, "Entscheid");
  const comment = text(body.comment, "Kommentar", 1000);
  const statements = () => [
    ctx.sql`WITH changed AS (
        UPDATE carecore_absences SET status = ${decision === "APPROVED" ? "approved" : "rejected"}, decided_by = ${ctx.actor.id},
          decided_at = NOW(), decision_note = ${comment}, updated_at = NOW() WHERE id = ${absence.id} AND status = 'requested' RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'REQUEST_CHANGED')`,
    auditQuery(ctx, {
      action: decision === "APPROVED" ? "approved" : "rejected",
      entityType: "absence",
      entityId: String(absence.id),
      unitId,
      before: { status: "requested" },
      after: { status: decision, employeeId },
      reason: comment,
    }),
    notificationQuery(ctx, {
      userId: employeeId,
      type: "TIME_OFF_DECIDED",
      title: decision === "APPROVED" ? "Abwesenheit bewilligt" : "Abwesenheit abgelehnt",
      message: `${label} wurde ${decision === "APPROVED" ? "bewilligt" : "abgelehnt"}${comment ? `: ${comment}` : "."}`,
      entityType: "absence",
      entityId: String(absence.id),
      href: "/c/mein-dienstplan/antraege",
    }),
  ];
  if (decision === "REJECTED") {
    await ctx.sql.transaction(statements());
    return { status: "rejected" };
  }
  const { acknowledged, reason } = acknowledgement(body);
  const result = await applyAbsence(
    ctx,
    {
      absenceId: String(absence.id),
      employeeId,
      kind,
      from,
      to,
      removeWork: bool(body.removeShifts),
      acknowledged,
      reason: reason ?? `Abwesenheit bewilligt${comment ? `: ${comment}` : ""}`,
    },
    statements,
    false,
  );
  return { status: "approved", ...result };
}

// --- Listen --------------------------------------------------------------------------------------

export type RequestItem = {
  id: string;
  type: "time_off" | "absence" | "preference";
  employeeId: string;
  employee: string;
  from: string | null;
  to: string | null;
  label: string;
  status: string;
  priority: string | null;
  comment: string | null;
  decisionComment: string | null;
  createdAt: string;
};

function mapTimeOff(row: Row): RequestItem {
  return {
    id: String(row.id),
    type: "time_off",
    employeeId: String(row.employee_id),
    employee: String(row.display_name),
    from: String(row.start_text),
    to: String(row.end_text),
    label: `Wunschfrei${row.reason ? ` · ${row.reason}` : ""}`,
    status: String(row.status),
    priority: String(row.priority),
    comment: row.comment ? String(row.comment) : null,
    decisionComment: row.decision_comment ? String(row.decision_comment) : null,
    createdAt: iso(row.created_at) ?? "",
  };
}

function mapAbsence(row: Row, lead: boolean, self: boolean): RequestItem {
  const status =
    { requested: "OPEN", approved: "APPROVED", rejected: "REJECTED", withdrawn: "WITHDRAWN", revoked: "WITHDRAWN" }[
      String(row.status)
    ] ?? "OPEN";
  return {
    id: String(row.id),
    type: "absence",
    employeeId: String(row.user_id),
    employee: String(row.display_name),
    from: String(row.from_text),
    to: String(row.to_text),
    // Kolleg:innen sehen nie den Grund (Spec 6.3); diese Liste sehen nur Leitung und die Person selbst.
    label: lead || self ? (ABSENCE_REQUEST_KINDS[row.kind as AbsenceRequestKind] ?? "Abwesenheit") : "Abwesend",
    status,
    priority: null,
    comment: row.note ? String(row.note) : null,
    decisionComment: row.decision_note ? String(row.decision_note) : null,
    createdAt: iso(row.created_at) ?? "",
  };
}

export async function myRequests(ctx: RosterContext) {
  const [timeOff, absences, preferences, types] = await Promise.all([
    ctx.sql`SELECT t.*, to_char(t.start_date, 'YYYY-MM-DD') AS start_text, to_char(t.end_date, 'YYYY-MM-DD') AS end_text, u.display_name
      FROM carecore_time_off_requests t JOIN carecore_users u ON u.id = t.employee_id
      WHERE t.employee_id = ${ctx.actor.id} ORDER BY t.start_date DESC LIMIT 100` as Promise<Row[]>,
    ctx.sql`SELECT ab.*, to_char(ab.starts_on, 'YYYY-MM-DD') AS from_text, to_char(ab.ends_on, 'YYYY-MM-DD') AS to_text, u.display_name
      FROM carecore_absences ab JOIN carecore_users u ON u.id = ab.user_id
      WHERE ab.user_id = ${ctx.actor.id} ORDER BY ab.starts_on DESC LIMIT 100` as Promise<Row[]>,
    ctx.sql`SELECT id, kind, shift_type_id, weekday, category, to_char(date, 'YYYY-MM-DD') AS date, to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
        to_char(valid_until, 'YYYY-MM-DD') AS valid_until, comment, active
      FROM carecore_shift_preferences WHERE employee_id = ${ctx.actor.id} ORDER BY created_at DESC` as Promise<Row[]>,
    loadShiftTypes(ctx),
  ]);
  return {
    timeOff: timeOff.map(mapTimeOff),
    absences: absences.map((row) => mapAbsence(row, false, true)),
    preferences: preferences.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      shiftTypeId: row.shift_type_id ? String(row.shift_type_id) : null,
      shiftType: row.shift_type_id ? (types[String(row.shift_type_id)]?.name ?? null) : null,
      weekday: row.weekday === null ? null : Number(row.weekday),
      category: row.category ? String(row.category) : null,
      date: row.date ? String(row.date) : null,
      validFrom: row.valid_from ? String(row.valid_from) : null,
      validUntil: row.valid_until ? String(row.valid_until) : null,
      comment: row.comment ? String(row.comment) : null,
      active: Boolean(row.active),
    })),
    shiftTypes: Object.values(types)
      .filter((t) => t.active && t.category !== "ABSENCE")
      .map((t) => ({ id: t.id, code: t.code, name: t.name })),
  };
}

// Offene und kürzlich entschiedene Anträge der geleiteten Wohnbereiche.
export async function unitRequests(ctx: RosterContext, unitId: string | null) {
  const units = unitId ? [unitId] : managedUnitIds(ctx.access);
  if (unitId) requirePermission(ctx, "wunschfrei:decide", unitId);
  else if (!units.length) throw forbidden("Anträge entscheidet die Leitung.");
  const [timeOff, absences, preferences, types] = await Promise.all([
    ctx.sql`SELECT t.*, to_char(t.start_date, 'YYYY-MM-DD') AS start_text, to_char(t.end_date, 'YYYY-MM-DD') AS end_text, u.display_name
      FROM carecore_time_off_requests t JOIN carecore_users u ON u.id = t.employee_id
      WHERE t.care_unit_id = ANY(${units}::uuid[]) AND (t.status = 'OPEN' OR t.updated_at > NOW() - INTERVAL '30 days')
      ORDER BY t.status <> 'OPEN', t.start_date LIMIT 200` as Promise<Row[]>,
    ctx.sql`SELECT ab.*, to_char(ab.starts_on, 'YYYY-MM-DD') AS from_text, to_char(ab.ends_on, 'YYYY-MM-DD') AS to_text, u.display_name
      FROM carecore_absences ab JOIN carecore_users u ON u.id = ab.user_id
      WHERE ab.organization_id = ${ctx.actor.organizationId}
        AND EXISTS (SELECT 1 FROM carecore_unit_memberships m WHERE m.user_id = ab.user_id AND m.plannable AND m.care_unit_id = ANY(${units}::uuid[]))
        AND (ab.status = 'requested' OR ab.updated_at > NOW() - INTERVAL '30 days')
      ORDER BY ab.status <> 'requested', ab.starts_on LIMIT 200` as Promise<Row[]>,
    ctx.sql`SELECT p.*, to_char(p.date, 'YYYY-MM-DD') AS date_text, u.display_name
      FROM carecore_shift_preferences p JOIN carecore_users u ON u.id = p.employee_id
      WHERE p.active AND EXISTS (SELECT 1 FROM carecore_unit_memberships m WHERE m.user_id = p.employee_id AND m.plannable AND m.care_unit_id = ANY(${units}::uuid[]))
      ORDER BY u.display_name` as Promise<Row[]>,
    loadShiftTypes(ctx),
  ]);
  return {
    timeOff: timeOff.map(mapTimeOff),
    absences: absences.map((row) => mapAbsence(row, isLeadOf(ctx.access, units[0]) || ctx.access.isAdmin, false)),
    preferences: preferences.map((row) => ({
      id: String(row.id),
      employee: String(row.display_name),
      kind: String(row.kind),
      shiftType: row.shift_type_id ? (types[String(row.shift_type_id)]?.name ?? null) : null,
      weekday: row.weekday === null ? null : Number(row.weekday),
      category: row.category ? String(row.category) : null,
      date: row.date_text ? String(row.date_text) : null,
      comment: row.comment ? String(row.comment) : null,
    })),
  };
}
