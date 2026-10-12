import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { RosterContext } from "./context";
import { requirePermission } from "./context";
import { auditQuery, notificationQuery, type NotificationInput } from "./audit";
import { ensurePeriod, loadEmployees, loadShift, loadSnapshot, mapShift, SHIFT_COLUMNS } from "./data";
import { RosterError, invalid, notFound } from "./errors";
import { applyChanges, blocking, unacknowledged, validateChanges } from "./rules";
import { acknowledgement, date, instant, int, optionalUuid, text, uuid, type Body } from "./schemas";
import { addDays, formatDate, localTime } from "./time";
import type {
  AuditSource,
  PeriodInfo,
  RosterShift,
  RuleCode,
  ScheduleSnapshot,
  ShiftChange,
  ShiftSource,
} from "./types";
import type { CommitResult } from "./view-types";

// Schreibt Dienständerungen (Spec 7, 8.3, 8.4): Snapshot laden → Regel-Engine → nur ohne BLOCK und
// mit bestätigten Warnungen schreiben. Alles in einer Transaktion: Versionsprüfung jedes Dienstes,
// Fingerabdruck der betroffenen Dienstpläne (gleichzeitige Änderungen), Audit, Benachrichtigungen.

export type CommitOptions = {
  unitId: string;
  changes: ShiftChange[];
  acknowledged: RuleCode[];
  reason: string | null;
  source: ShiftSource;
  auditSource?: AuditSource;
  // Scope override for flows where the actor is not the planner (e.g. employees swapping).
  snapshotScope?: (snapshot: ScheduleSnapshot) => ScheduleSnapshot;
  // Further statements that must be part of the same transaction (e.g. the swap record).
  extra?: (applied: { shifts: RosterShift[]; previous: RosterShift[] }) => ReturnType<RosterContext["sql"]>[];
  notify?: boolean;
  swapId?: string | null;
};

// md5 over "id:version" of the given shifts, same as the SQL check below.
export function fingerprint(shifts: RosterShift[]) {
  if (!shifts.length) return "";
  return createHash("md5")
    .update(
      [...shifts]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((shift) => `${shift.id}:${shift.version}`)
        .join(","),
    )
    .digest("hex");
}

function fingerprintQuery(ctx: RosterContext, employeeIds: string[], from: string, to: string, expected: string) {
  return ctx.sql`
    SELECT carecore_assert(COALESCE(md5(string_agg(id::text || ':' || version, ',' ORDER BY id)), '') = ${expected}, 'PLAN_CHANGED')
    FROM carecore_roster_shifts
    WHERE organization_id = ${ctx.actor.organizationId} AND employee_id = ANY(${employeeIds}::uuid[])
      AND date BETWEEN ${from}::date AND ${to}::date`;
}

const describe = (snapshot: ScheduleSnapshot, shift: RosterShift) => {
  const type = snapshot.shiftTypes[shift.shiftTypeId];
  const tz = snapshot.ruleSet.timezone;
  return `${type?.name ?? "Dienst"} ${localTime(shift.plannedStart, tz)}–${localTime(shift.plannedEnd, tz)}`;
};

const auditShape = (shift: RosterShift | undefined) =>
  shift && {
    employeeId: shift.employeeId,
    shiftTypeId: shift.shiftTypeId,
    date: shift.date,
    plannedStart: shift.plannedStart,
    plannedEnd: shift.plannedEnd,
    breakMinutes: shift.breakMinutes,
    unitId: shift.unitId,
    version: shift.version,
    notes: shift.notes,
  };

export async function commitChanges(ctx: RosterContext, options: CommitOptions): Promise<CommitResult> {
  const { unitId, changes } = options;
  // Dates and people touched by the changes, including the current state of changed shifts.
  const dates: string[] = [];
  const employees = new Set<string>();
  for (const change of changes) {
    if (change.kind === "create") {
      dates.push(change.shift.date);
      employees.add(change.shift.employeeId);
    } else if (change.kind === "move") {
      dates.push(change.date);
      employees.add(change.employeeId);
    } else if (change.kind === "update") {
      if (change.patch.date) dates.push(change.patch.date);
      if (change.patch.employeeId) employees.add(change.patch.employeeId);
    } else if (change.kind === "swap") employees.add(change.targetEmployeeId);
  }
  const existingIds = changes.flatMap((change) =>
    change.kind === "create"
      ? []
      : change.kind === "swap"
        ? [change.sourceShiftId, ...(change.targetShiftId ? [change.targetShiftId] : [])]
        : [change.shiftId],
  );
  const existing = await Promise.all(existingIds.map((id) => loadShift(ctx, id)));
  // Shifts of other units (e.g. a Springer's) are allowed; the rule engine checks the scope.
  for (const shift of existing) {
    dates.push(shift.date);
    employees.add(shift.employeeId);
  }
  if (!dates.length) throw invalid("Keine Änderung angegeben.");
  const from = [...dates].sort()[0];
  const to = [...dates].sort().at(-1)!;

  let snapshot = await loadSnapshot(ctx, { unitId, from, to, employeeIds: [...employees] });
  if (options.snapshotScope) snapshot = options.snapshotScope(snapshot);
  const violations = validateChanges(snapshot, changes);
  const blocks = blocking(violations);
  if (blocks.length) {
    // A stale plan is a reload case for the client, not a rule the user can fix.
    const stale = blocks.find((v) => v.code === "STALE_VERSION");
    if (stale) throw new RosterError("STALE_VERSION", stale.message, 409, violations);
    throw new RosterError("RULE_VIOLATION", blocks[0].message, 422, violations);
  }
  if (unacknowledged(violations, options.acknowledged).length)
    throw new RosterError(
      "CONFIRMATION_REQUIRED",
      "Bitte die Warnungen prüfen und mit Begründung bestätigen.",
      409,
      violations,
    );

  const applied = applyChanges(snapshot, changes);
  const periods = new Map<string, PeriodInfo>(snapshot.periods.map((p) => [p.id, p]));
  for (const shift of applied.touched)
    if (!shift.periodId) {
      const period = await ensurePeriod(
        ctx,
        shift.unitId,
        Number(shift.date.slice(0, 4)),
        Number(shift.date.slice(5, 7)),
      );
      if (period.lockedAt) throw new RosterError("PERIOD_LOCKED", "Der Monat ist abgeschlossen.", 422);
      shift.periodId = period.id;
      periods.set(period.id, period);
    }

  const involved = [...employees];
  const windowFrom = addDays(from, -7);
  const windowTo = addDays(to, 7);
  const before = snapshot.shifts.filter(
    (shift) => involved.includes(shift.employeeId) && shift.date >= windowFrom && shift.date <= windowTo,
  );
  const statements = [fingerprintQuery(ctx, involved, windowFrom, windowTo, fingerprint(before))];
  const reason = options.reason
    ? `${options.reason}${options.acknowledged.length ? ` (bestätigt: ${options.acknowledged.join(", ")})` : ""}`
    : null;
  const audit = (action: string, entityId: string, previous: RosterShift | undefined, after: RosterShift | undefined) =>
    auditQuery(ctx, {
      action,
      entityType: "shift",
      entityId,
      unitId: after?.unitId ?? previous?.unitId ?? unitId,
      before: auditShape(previous),
      after: auditShape(after),
      reason,
      source: options.auditSource ?? (options.source === "AI" ? "AI" : options.source === "SWAP" ? "SWAP" : "UI"),
    });

  const notifications: NotificationInput[] = [];
  const published = (shift: RosterShift) => periods.get(shift.periodId)?.status === "PUBLISHED";
  const href = (shift: RosterShift) => `/c/mein-dienstplan?monat=${shift.date.slice(0, 7)}`;
  const notifyShift = (
    userId: string,
    type: NotificationInput["type"],
    title: string,
    message: string,
    shift: RosterShift,
  ) => {
    if (options.notify === false || userId === ctx.actor.id || !published(shift)) return;
    notifications.push({ userId, type, title, message, entityType: "shift", entityId: shift.id, href: href(shift) });
  };

  const previousById = new Map(applied.previous.map((shift) => [shift.id, shift]));
  const actions = new Map<string, string>(
    changes.flatMap((change): Array<[string, string]> =>
      change.kind === "create"
        ? [[change.shift.id, "created"]]
        : change.kind === "swap"
          ? [
              [change.sourceShiftId, "swapped"],
              ...(change.targetShiftId ? [[change.targetShiftId, "swapped"] as [string, string]] : []),
            ]
          : [[change.shiftId, change.kind === "move" ? "moved" : change.kind === "delete" ? "deleted" : "updated"]],
    ),
  );

  for (const shift of applied.touched) {
    const previous = previousById.get(shift.id);
    const action = actions.get(shift.id) ?? "updated";
    const source = action === "swapped" ? "SWAP" : options.source;
    if (!previous) {
      statements.push(ctx.sql`
        INSERT INTO carecore_roster_shifts (id, organization_id, period_id, care_unit_id, employee_id, shift_type_id, category, date,
          planned_start, planned_end, break_minutes, source, notes, version, created_by, updated_by)
        VALUES (${shift.id}, ${ctx.actor.organizationId}, ${shift.periodId}, ${shift.unitId}, ${shift.employeeId}, ${shift.shiftTypeId},
          ${shift.category}, ${shift.date}, ${shift.plannedStart}, ${shift.plannedEnd}, ${shift.breakMinutes}, ${source},
          ${shift.notes}, 1, ${ctx.actor.id}, ${ctx.actor.id})`);
      statements.push(audit(action, shift.id, undefined, { ...shift, version: 1 }));
      notifyShift(
        shift.employeeId,
        "SHIFT_CHANGED",
        `Neuer Dienst am ${formatDate(shift.date)}`,
        `Du bist am ${formatDate(shift.date)} eingeteilt: ${describe(snapshot, shift)}.`,
        shift,
      );
      continue;
    }
    statements.push(ctx.sql`
      WITH changed AS (
        UPDATE carecore_roster_shifts SET employee_id = ${shift.employeeId}, shift_type_id = ${shift.shiftTypeId},
          category = ${shift.category}, date = ${shift.date}, planned_start = ${shift.plannedStart}, planned_end = ${shift.plannedEnd},
          break_minutes = ${shift.breakMinutes}, notes = ${shift.notes}, period_id = ${shift.periodId}, source = ${source},
          last_swap_id = ${action === "swapped" ? (options.swapId ?? null) : previous.lastSwapId}, version = version + 1,
          updated_at = NOW(), updated_by = ${ctx.actor.id}
        WHERE id = ${shift.id} AND version = ${previous.version} AND organization_id = ${ctx.actor.organizationId}
        RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'STALE_VERSION')`);
    statements.push(audit(action, shift.id, previous, { ...shift, version: previous.version + 1 }));
    if (previous.employeeId !== shift.employeeId) {
      notifyShift(
        previous.employeeId,
        "SHIFT_DELETED",
        `Dienst am ${formatDate(previous.date)} entfällt`,
        action === "swapped"
          ? `Dein Dienst am ${formatDate(previous.date)} (${describe(snapshot, previous)}) wurde getauscht.`
          : `Dein Dienst am ${formatDate(previous.date)} (${describe(snapshot, previous)}) wurde einer anderen Person zugeteilt.`,
        previous,
      );
      notifyShift(
        shift.employeeId,
        "SHIFT_CHANGED",
        `Neuer Dienst am ${formatDate(shift.date)}`,
        `Du bist am ${formatDate(shift.date)} eingeteilt: ${describe(snapshot, shift)}.`,
        shift,
      );
    } else
      notifyShift(
        shift.employeeId,
        "SHIFT_CHANGED",
        `Dein Dienst am ${formatDate(previous.date)} wurde geändert`,
        `${formatDate(previous.date)}: ${describe(snapshot, previous)} → ${formatDate(shift.date) === formatDate(previous.date) ? "" : `${formatDate(shift.date)}: `}${describe(snapshot, shift)}.`,
        shift,
      );
  }

  const remaining = new Set(applied.shifts.map((shift) => shift.id));
  for (const previous of applied.previous) {
    if (remaining.has(previous.id)) continue;
    statements.push(ctx.sql`
      WITH removed AS (
        DELETE FROM carecore_roster_shifts
        WHERE id = ${previous.id} AND version = ${previous.version} AND organization_id = ${ctx.actor.organizationId}
        RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM removed), 'STALE_VERSION')`);
    statements.push(audit("deleted", previous.id, previous, undefined));
    notifyShift(
      previous.employeeId,
      "SHIFT_DELETED",
      `Dienst am ${formatDate(previous.date)} gestrichen`,
      `Dein Dienst am ${formatDate(previous.date)} (${describe(snapshot, previous)}) wurde gestrichen.`,
      previous,
    );
  }

  if (options.extra) statements.push(...options.extra({ shifts: applied.shifts, previous: applied.previous }));
  for (const notification of notifications) statements.push(notificationQuery(ctx, notification));
  await ctx.sql.transaction(statements);
  return {
    violations: violations.filter((v) => v.severity !== "BLOCK"),
    shiftIds: applied.touched.map((shift) => shift.id),
  };
}

// --- Endpunkte der Leitung (Raster) -------------------------------------------------------------

export async function createShift(ctx: RosterContext, body: Body) {
  const unitId = uuid(body.unitId, "Wohnbereich");
  requirePermission(ctx, "dienstplan:create", unitId);
  const { acknowledged, reason } = acknowledgement(body);
  const custom = body.plannedStart && body.plannedEnd;
  const employeeId = uuid(body.employeeId, "Person");
  // "Dem Wohnbereich zuordnen": Person des Hauses wird beim Einplanen im Wohnbereich planbar –
  // in derselben Transaktion wie der Dienst, damit ohne gültigen Dienst keine Zuordnung entsteht.
  const addToUnit = body.addToUnit === true;
  if (addToUnit) {
    const employee = (await loadEmployees(ctx, [employeeId]))[employeeId];
    if (!employee) throw notFound("Person");
    if (!employee.active) throw invalid(`${employee.name} ist nicht aktiv und kann nicht eingeplant werden.`);
  }
  return commitChanges(ctx, {
    unitId,
    acknowledged,
    reason,
    source: "MANUAL",
    snapshotScope: addToUnit
      ? (snapshot) => {
          const employee = snapshot.employees[employeeId];
          if (!employee || employee.unitIds.includes(unitId)) return snapshot;
          return {
            ...snapshot,
            employees: { ...snapshot.employees, [employeeId]: { ...employee, unitIds: [...employee.unitIds, unitId] } },
          };
        }
      : undefined,
    extra: addToUnit
      ? () => [
          ctx.sql`INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
            VALUES (${employeeId}, ${unitId}, TRUE, FALSE)
            ON CONFLICT (user_id, care_unit_id) DO UPDATE SET plannable = TRUE`,
          ctx.sql`INSERT INTO carecore_employee_profiles (user_id) VALUES (${employeeId}) ON CONFLICT (user_id) DO NOTHING`,
          auditQuery(ctx, {
            action: "updated",
            entityType: "employee_profile",
            entityId: employeeId,
            unitId,
            after: { employeeId, plannable: true },
            reason: "Beim Einplanen dem Wohnbereich zugeordnet",
          }),
        ]
      : undefined,
    changes: [
      {
        kind: "create",
        shift: {
          id: randomUUID(),
          unitId,
          employeeId,
          shiftTypeId: uuid(body.shiftTypeId, "Diensttyp"),
          date: date(body.date, "Datum"),
          plannedStart: custom ? instant(body.plannedStart, "Beginn") : undefined,
          plannedEnd: custom ? instant(body.plannedEnd, "Ende") : undefined,
          breakMinutes:
            body.breakMinutes === undefined || body.breakMinutes === null
              ? undefined
              : int(body.breakMinutes, "Pause", 0, 240),
          notes: text(body.notes, "Notiz", 500),
        },
      },
    ],
  });
}

// PEP-Arbeitsweise: mehrere Zellen (Person × Tag) auf einmal setzen oder leeren – Kürzel tippen,
// Stempeln, Einfügen, Woche übertragen. Eine Zelle mit shiftTypeId null wird geleert. Alles in einer
// Regelprüfung und einer Transaktion; Dienste mit Zeiterfassung bleiben unangetastet.
export const MAX_CELLS = 1500;
export async function setCells(ctx: RosterContext, body: Body) {
  const unitId = uuid(body.unitId, "Wohnbereich");
  requirePermission(ctx, "dienstplan:update", unitId);
  const { acknowledged, reason } = acknowledgement(body);
  if (!Array.isArray(body.cells) || !body.cells.length) throw invalid("Keine Zellen angegeben.");
  if (body.cells.length > MAX_CELLS) throw invalid(`Höchstens ${MAX_CELLS} Zellen auf einmal.`);
  const cells = new Map<string, { employeeId: string; date: string; shiftTypeId: string | null }>();
  for (const raw of body.cells as Array<Record<string, unknown>>) {
    const cell = {
      employeeId: uuid(raw?.employeeId, "Person"),
      date: date(raw?.date, "Datum"),
      shiftTypeId: optionalUuid(raw?.shiftTypeId, "Diensttyp"),
    };
    cells.set(`${cell.employeeId}|${cell.date}`, cell);
  }
  const list = [...cells.values()];
  const dates = list.map((c) => c.date).sort();
  const rows = (await ctx.sql.query(
    `SELECT ${SHIFT_COLUMNS} FROM carecore_roster_shifts s
     WHERE s.care_unit_id = $1 AND s.employee_id = ANY($2::uuid[]) AND s.date BETWEEN $3::date AND $4::date`,
    [unitId, [...new Set(list.map((c) => c.employeeId))], dates[0], dates.at(-1)],
  )) as Array<Record<string, unknown>>;
  const existing = rows.map(mapShift);
  const changes: ShiftChange[] = [];
  let skipped = 0;
  for (const cell of list) {
    const inCell = existing.filter((s) => s.employeeId === cell.employeeId && s.date === cell.date);
    const locked = inCell.filter((s) => s.hasTimeEntry);
    const editable = inCell.filter((s) => !s.hasTimeEntry);
    if (locked.length) {
      skipped += 1;
      continue;
    }
    if (!cell.shiftTypeId) {
      changes.push(...editable.map((s) => ({ kind: "delete" as const, shiftId: s.id, expectedVersion: s.version })));
      continue;
    }
    const [first, ...rest] = editable;
    changes.push(...rest.map((s) => ({ kind: "delete" as const, shiftId: s.id, expectedVersion: s.version })));
    if (!first)
      changes.push({
        kind: "create",
        shift: {
          id: randomUUID(),
          unitId,
          employeeId: cell.employeeId,
          shiftTypeId: cell.shiftTypeId,
          date: cell.date,
        },
      });
    else if (first.shiftTypeId !== cell.shiftTypeId)
      changes.push({
        kind: "update",
        shiftId: first.id,
        expectedVersion: first.version,
        patch: { shiftTypeId: cell.shiftTypeId },
      });
  }
  if (!changes.length) return { shiftIds: [], violations: [], skipped, changed: 0 };
  const result = await commitChanges(ctx, { unitId, acknowledged, reason, source: "MANUAL", changes });
  return { ...result, skipped, changed: changes.length };
}

// update | move | delete | swap (Drag & Drop auf eine belegte Zelle).
export async function changeShift(ctx: RosterContext, shiftId: string, body: Body) {
  const current = await loadShift(ctx, uuid(shiftId, "Dienst"));
  const action = body.action;
  requirePermission(ctx, action === "delete" ? "dienstplan:delete" : "dienstplan:update", current.unitId);
  const expectedVersion = int(body.expectedVersion, "Version", 0, 1_000_000);
  const { acknowledged, reason } = acknowledgement(body);
  const base = { unitId: current.unitId, acknowledged, reason };
  if (action === "delete")
    return commitChanges(ctx, {
      ...base,
      source: "MANUAL",
      changes: [{ kind: "delete", shiftId: current.id, expectedVersion }],
    });
  if (action === "move")
    return commitChanges(ctx, {
      ...base,
      source: body.dragged === true ? "DRAG_DROP" : "MANUAL",
      changes: [
        {
          kind: "move",
          shiftId: current.id,
          expectedVersion,
          employeeId: uuid(body.employeeId, "Person"),
          date: date(body.date, "Datum"),
        },
      ],
    });
  if (action === "swap") {
    const target = await loadShift(ctx, uuid(body.targetShiftId, "Gegendienst"));
    return commitChanges(ctx, {
      ...base,
      source: "SWAP",
      changes: [
        {
          kind: "swap",
          sourceShiftId: current.id,
          sourceVersion: expectedVersion,
          targetEmployeeId: target.employeeId,
          targetShiftId: target.id,
          targetVersion: int(body.targetVersion, "Version", 0, 1_000_000),
        },
      ],
    });
  }
  if (action !== "update") throw invalid("Unbekannte Aktion.");
  const custom = body.plannedStart && body.plannedEnd;
  return commitChanges(ctx, {
    ...base,
    source: "MANUAL",
    changes: [
      {
        kind: "update",
        shiftId: current.id,
        expectedVersion,
        patch: {
          shiftTypeId: optionalUuid(body.shiftTypeId, "Diensttyp") ?? undefined,
          employeeId: optionalUuid(body.employeeId, "Person") ?? undefined,
          date: body.date ? date(body.date, "Datum") : undefined,
          plannedStart: custom ? instant(body.plannedStart, "Beginn") : undefined,
          plannedEnd: custom ? instant(body.plannedEnd, "Ende") : undefined,
          breakMinutes:
            body.breakMinutes === undefined || body.breakMinutes === null
              ? undefined
              : int(body.breakMinutes, "Pause", 0, 240),
          notes: body.notes === undefined ? undefined : text(body.notes, "Notiz", 500),
        },
      },
    ],
  });
}
