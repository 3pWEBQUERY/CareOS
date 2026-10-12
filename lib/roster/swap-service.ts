import "server-only";
import { randomUUID } from "node:crypto";
import type { Row } from "@/lib/api-context";
import { iso } from "@/lib/api-context";
import { auditQuery, notificationQuery, resolveRecipients } from "./audit";
import type { RosterContext } from "./context";
import { requirePermission } from "./context";
import { loadRuleSet, loadShift, loadSnapshot, unitMemberIds } from "./data";
import { RosterError, invalid, notFound, toRosterError } from "./errors";
import { isLeadOf } from "./permissions";
import { blocking, validateChanges } from "./rules";
import { acknowledgement, bool, optionalUuid, text, uuid, type Body } from "./schemas";
import { commitChanges } from "./shift-service";
import { addDays, formatDate, localTime } from "./time";
import type { RosterShift, ScheduleSnapshot, ShiftChange, SwapStatus } from "./types";

// Diensttausch (Spec 8.8): Kandidatensuche mit derselben Regel-Engine, Zustandsautomat,
// atomare Ausführung (Versionsprüfung beider Dienste, erneute Regelprüfung, Audit, Benachrichtigungen).

const ACTIVE: SwapStatus[] = ["PENDING_TARGET", "PENDING_APPROVAL"];

type SwapRow = Row & {
  id: string;
  status: SwapStatus;
  care_unit_id: string;
  requester_id: string;
  target_employee_id: string;
  source_shift_id: string;
  target_shift_id: string | null;
  source_shift_version: number;
  target_shift_version: number | null;
};

// Warum ein Dienst nicht tauschbar ist – oder null.
async function notTradable(ctx: RosterContext, shift: RosterShift) {
  if (shift.category === "ABSENCE") return "Abwesenheiten können nicht getauscht werden.";
  if (Date.parse(shift.plannedStart) <= Date.now())
    return "Dienste in der Vergangenheit oder bereits begonnene Dienste können nicht getauscht werden.";
  if (shift.hasTimeEntry) return "Für diesen Dienst wurde bereits Arbeitszeit erfasst.";
  const rows = (await ctx.sql`
    SELECT p.status, p.locked_at,
      EXISTS (SELECT 1 FROM carecore_shift_swaps sw WHERE (sw.source_shift_id = ${shift.id} OR sw.target_shift_id = ${shift.id})
        AND sw.status IN ('PENDING_TARGET', 'PENDING_APPROVAL')) AS active_swap
    FROM carecore_schedule_periods p WHERE p.id = ${shift.periodId}`) as Row[];
  const period = rows[0];
  if (!period || period.status !== "PUBLISHED") return "Dienste in Entwürfen können nicht getauscht werden.";
  if (period.locked_at) return "Der Monat ist abgeschlossen.";
  if (period.active_swap) return "Für diesen Dienst läuft bereits ein Tausch.";
  return null;
}

const describe = (snapshot: ScheduleSnapshot, shift: RosterShift) =>
  `${snapshot.shiftTypes[shift.shiftTypeId]?.name ?? "Dienst"} am ${formatDate(shift.date)} (${localTime(shift.plannedStart, snapshot.ruleSet.timezone)}–${localTime(shift.plannedEnd, snapshot.ruleSet.timezone)})`;

// Employees plan their own swaps: the scope is the unit of the shift, not a led unit.
const unitScope = (unitId: string) => (snapshot: ScheduleSnapshot) => ({ ...snapshot, managedUnitIds: [unitId] });

export type SwapCandidate = {
  employeeId: string;
  name: string;
  targetShiftId: string | null;
  targetShiftVersion: number | null;
  targetShift: string | null;
  warnings: string[];
};

export async function getSwapCandidates(ctx: RosterContext, shiftId: string) {
  const source = await loadShift(ctx, uuid(shiftId, "Dienst"));
  if (source.employeeId !== ctx.actor.id) throw notFound("Dienst");
  requirePermission(ctx, "diensttausch:create", source.unitId);
  const reason = await notTradable(ctx, source);
  if (reason) throw invalid(reason);
  const rules = await loadRuleSet(ctx, source.unitId);
  const members = (await unitMemberIds(ctx, source.unitId)).filter((id) => id !== ctx.actor.id);
  const snapshot = unitScope(source.unitId)(
    await loadSnapshot(ctx, {
      unitId: source.unitId,
      from: addDays(source.date, -14),
      to: addDays(source.date, 14),
      employeeIds: members,
    }),
  );
  const activeRows = (await ctx.sql`
    SELECT source_shift_id, target_shift_id FROM carecore_shift_swaps
    WHERE care_unit_id = ${source.unitId} AND status IN ('PENDING_TARGET', 'PENDING_APPROVAL')`) as Row[];
  const busy = new Set(
    activeRows.flatMap((row) => [String(row.source_shift_id), row.target_shift_id ? String(row.target_shift_id) : ""]),
  );
  const published = new Set(snapshot.periods.filter((p) => p.status === "PUBLISHED" && !p.lockedAt).map((p) => p.id));
  const candidates: Array<SwapCandidate & { distance: number }> = [];
  for (const employeeId of members) {
    const employee = snapshot.employees[employeeId];
    if (!employee?.active) continue;
    const counter = snapshot.shifts.filter(
      (s) =>
        s.employeeId === employeeId &&
        s.unitId === source.unitId &&
        s.category !== "ABSENCE" &&
        !s.hasTimeEntry &&
        !busy.has(s.id) &&
        published.has(s.periodId) &&
        Date.parse(s.plannedStart) > Date.now() &&
        Math.abs(Date.parse(`${s.date}T12:00:00Z`) - Date.parse(`${source.date}T12:00:00Z`)) <= 14 * 86_400_000,
    );
    const options: Array<RosterShift | null> = [...counter, ...(rules.allowShiftTakeover ? [null] : [])];
    for (const target of options) {
      const change: ShiftChange = {
        kind: "swap",
        sourceShiftId: source.id,
        sourceVersion: source.version,
        targetEmployeeId: employeeId,
        targetShiftId: target?.id ?? null,
        targetVersion: target?.version ?? null,
      };
      const violations = validateChanges(snapshot, [change]);
      if (blocking(violations).length) continue;
      candidates.push({
        employeeId,
        name: employee.name,
        targetShiftId: target?.id ?? null,
        targetShiftVersion: target?.version ?? null,
        // Nur Name und Gegendienst – keine weiteren Plandaten (Spec 8.8).
        targetShift: target ? describe(snapshot, target) : null,
        warnings: violations.filter((v) => v.severity === "WARN").map((v) => v.message),
        distance: target
          ? Math.abs(Date.parse(`${target.date}T12:00:00Z`) - Date.parse(`${source.date}T12:00:00Z`))
          : 0,
      });
    }
  }
  candidates.sort(
    (a, b) => a.warnings.length - b.warnings.length || a.distance - b.distance || a.name.localeCompare(b.name, "de-CH"),
  );
  return {
    shift: { id: source.id, label: describe(snapshot, source), version: source.version },
    candidates: candidates.slice(0, 40).map((candidate) => ({
      employeeId: candidate.employeeId,
      name: candidate.name,
      targetShiftId: candidate.targetShiftId,
      targetShiftVersion: candidate.targetShiftVersion,
      targetShift: candidate.targetShift,
      warnings: candidate.warnings,
    })),
    takeoverAllowed: rules.allowShiftTakeover,
  };
}

export async function createSwap(ctx: RosterContext, body: Body) {
  const source = await loadShift(ctx, uuid(body.sourceShiftId, "Dienst"));
  if (source.employeeId !== ctx.actor.id) throw notFound("Dienst");
  requirePermission(ctx, "diensttausch:create", source.unitId);
  const reason = await notTradable(ctx, source);
  if (reason) throw invalid(reason);
  const targetEmployeeId = uuid(body.targetEmployeeId, "Tauschpartner:in");
  const targetShiftId = optionalUuid(body.targetShiftId, "Gegendienst");
  const rules = await loadRuleSet(ctx, source.unitId);
  if (!targetShiftId && !rules.allowShiftTakeover) throw invalid("Eine Übernahme ohne Gegendienst ist nicht erlaubt.");
  const target = targetShiftId ? await loadShift(ctx, targetShiftId) : null;
  if (target) {
    if (target.employeeId !== targetEmployeeId || target.unitId !== source.unitId) throw notFound("Gegendienst");
    const why = await notTradable(ctx, target);
    if (why) throw invalid(`Gegendienst: ${why}`);
  }
  const snapshot = unitScope(source.unitId)(
    await loadSnapshot(ctx, {
      unitId: source.unitId,
      from: source.date,
      to: target?.date ?? source.date,
      employeeIds: [targetEmployeeId],
    }),
  );
  const violations = validateChanges(snapshot, [
    {
      kind: "swap",
      sourceShiftId: source.id,
      sourceVersion: source.version,
      targetEmployeeId,
      targetShiftId: target?.id ?? null,
      targetVersion: target?.version ?? null,
    },
  ]);
  if (blocking(violations).length)
    throw new RosterError("RULE_VIOLATION", blocking(violations)[0].message, 422, violations);
  const id = randomUUID();
  const message = text(body.message, "Nachricht", 500);
  await ctx.sql.transaction([
    ctx.sql`INSERT INTO carecore_shift_swaps (id, organization_id, care_unit_id, requester_id, target_employee_id, source_shift_id,
        target_shift_id, source_shift_version, target_shift_version, message)
      VALUES (${id}, ${ctx.actor.organizationId}, ${source.unitId}, ${ctx.actor.id}, ${targetEmployeeId}, ${source.id},
        ${target?.id ?? null}, ${source.version}, ${target?.version ?? null}, ${message})`,
    auditQuery(ctx, {
      action: "requested",
      entityType: "swap",
      entityId: id,
      unitId: source.unitId,
      after: {
        sourceShiftId: source.id,
        targetShiftId: target?.id ?? null,
        targetEmployeeId,
        status: "PENDING_TARGET",
      },
      source: "SWAP",
    }),
    notificationQuery(ctx, {
      userId: targetEmployeeId,
      type: "SWAP_REQUESTED",
      title: `Tauschanfrage von ${ctx.actor.display_name}`,
      message: `${ctx.actor.display_name} möchte ${describe(snapshot, source)}${target ? ` gegen deinen ${describe(snapshot, target)}` : " an dich abgeben"} tauschen.${message ? ` „${message}“` : ""}`,
      entityType: "swap",
      entityId: id,
      href: "/c/mein-dienstplan/antraege",
    }),
  ]);
  return { id, status: "PENDING_TARGET" as const };
}

async function loadSwap(ctx: RosterContext, id: string) {
  const rows = (await ctx.sql`
    SELECT * FROM carecore_shift_swaps WHERE id = ${uuid(id, "Tausch")} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw notFound("Tausch");
  return rows[0] as SwapRow;
}

async function setStatus(
  ctx: RosterContext,
  swap: SwapRow,
  status: SwapStatus,
  extra: { code?: string; message?: string; statements?: ReturnType<RosterContext["sql"]>[] } = {},
) {
  await ctx.sql.transaction([
    ctx.sql`WITH changed AS (
        UPDATE carecore_shift_swaps SET status = ${status}, failure_code = ${extra.code ?? null}, failure_message = ${extra.message ?? null},
          responded_at = COALESCE(responded_at, NOW()), updated_at = NOW()
        WHERE id = ${swap.id} AND status = ${swap.status} RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'SWAP_CHANGED')`,
    auditQuery(ctx, {
      action: status.toLowerCase(),
      entityType: "swap",
      entityId: swap.id,
      unitId: swap.care_unit_id,
      before: { status: swap.status },
      after: { status, failureCode: extra.code ?? null },
      reason: extra.message ?? null,
      source: "SWAP",
    }),
    ...(extra.statements ?? []),
  ]);
}

// Führt einen Tausch aus: beide Dienste mit Versionsprüfung, erneute Regelprüfung, alles oder nichts.
async function execute(ctx: RosterContext, swap: SwapRow, approvedBy: string | null) {
  let snapshotForMessages: ScheduleSnapshot | null = null;
  const leads = await resolveRecipients(ctx, { leadsOf: swap.care_unit_id, includeActor: false });
  try {
    await commitChanges(ctx, {
      unitId: swap.care_unit_id,
      acknowledged: ["MIN_STAFFING", "MIN_QUALIFIED", "MAX_WEEKLY_WORK", "MAX_CONSECUTIVE_DAYS"],
      reason: "Diensttausch",
      source: "SWAP",
      auditSource: "SWAP",
      swapId: swap.id,
      notify: false,
      snapshotScope: (snapshot) => {
        snapshotForMessages = snapshot;
        return unitScope(swap.care_unit_id)(snapshot);
      },
      changes: [
        {
          kind: "swap",
          sourceShiftId: swap.source_shift_id,
          sourceVersion: Number(swap.source_shift_version),
          targetEmployeeId: swap.target_employee_id,
          targetShiftId: swap.target_shift_id,
          targetVersion: swap.target_shift_version === null ? null : Number(swap.target_shift_version),
        },
      ],
      extra: () => [
        ctx.sql`WITH changed AS (
            UPDATE carecore_shift_swaps SET status = 'EXECUTED', executed_at = NOW(), responded_at = COALESCE(responded_at, NOW()),
              approved_at = CASE WHEN ${approvedBy}::uuid IS NULL THEN approved_at ELSE NOW() END,
              approved_by = COALESCE(${approvedBy}::uuid, approved_by), updated_at = NOW()
            WHERE id = ${swap.id} AND status = ${swap.status} RETURNING id)
          SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'SWAP_CHANGED')`,
        auditQuery(ctx, {
          action: "executed",
          entityType: "swap",
          entityId: swap.id,
          unitId: swap.care_unit_id,
          before: { status: swap.status },
          after: { status: "EXECUTED" },
          source: "SWAP",
        }),
        ...[
          swap.requester_id,
          swap.target_employee_id,
          ...leads.filter((id) => id !== swap.requester_id && id !== swap.target_employee_id),
        ].map((userId) =>
          notificationQuery(ctx, {
            userId,
            type: "SWAP_EXECUTED",
            title: "Diensttausch ausgeführt",
            message: `Der Diensttausch ${snapshotForMessages ? describeSwap(snapshotForMessages, swap) : ""} wurde ausgeführt.`,
            entityType: "swap",
            entityId: swap.id,
            href:
              userId === swap.requester_id || userId === swap.target_employee_id
                ? "/c/mein-dienstplan"
                : "/c/dienstplan/antraege",
          }),
        ),
      ],
    });
    return "EXECUTED" as const;
  } catch (error) {
    const known = toRosterError(error);
    if (!known) throw error;
    const expired = known.code === "STALE_VERSION" || known.code === "EXPIRED" || known.code === "PLAN_CHANGED";
    const status: SwapStatus = expired ? "EXPIRED" : "FAILED";
    const current = await loadSwap(ctx, swap.id);
    if (ACTIVE.includes(current.status)) {
      await setStatus(ctx, current, status, { code: known.code, message: known.message });
      const recipients = [swap.requester_id, swap.target_employee_id].filter((id) => id !== ctx.actor.id);
      if (!expired && recipients.length)
        await ctx.sql.transaction(
          recipients.map((userId) =>
            notificationQuery(ctx, {
              userId,
              type: "SWAP_FAILED",
              title: "Diensttausch nicht möglich",
              message: known.message,
              entityType: "swap",
              entityId: swap.id,
              href: "/c/mein-dienstplan/antraege",
            }),
          ),
        );
    }
    throw new RosterError(
      status,
      expired ? "Der Tausch ist abgelaufen, weil sich die Dienste geändert haben." : known.message,
      409,
      known.violations,
    );
  }
}

function describeSwap(snapshot: ScheduleSnapshot, swap: SwapRow) {
  const source = snapshot.shifts.find((s) => s.id === swap.source_shift_id);
  const target = swap.target_shift_id ? snapshot.shifts.find((s) => s.id === swap.target_shift_id) : null;
  return source ? `${describe(snapshot, source)}${target ? ` ↔ ${describe(snapshot, target)}` : " (Übernahme)"}` : "";
}

// Ziel nimmt an oder lehnt ab; bei Annahme wird erneut geprüft und je nach Regelwerk ausgeführt.
export async function respondToSwap(ctx: RosterContext, id: string, body: Body) {
  const swap = await loadSwap(ctx, id);
  if (swap.target_employee_id !== ctx.actor.id) throw notFound("Tausch");
  if (swap.status !== "PENDING_TARGET") throw invalid("Diese Anfrage ist nicht mehr offen.");
  if (!bool(body.accept)) {
    await setStatus(ctx, swap, "DECLINED", {
      statements: [
        notificationQuery(ctx, {
          userId: swap.requester_id,
          type: "SWAP_DECLINED",
          title: "Tauschanfrage abgelehnt",
          message: `${ctx.actor.display_name} hat deine Tauschanfrage abgelehnt.`,
          entityType: "swap",
          entityId: swap.id,
          href: "/c/mein-dienstplan/antraege",
        }),
      ],
    });
    return { status: "DECLINED" as const };
  }
  // Veraltete Dienste → EXPIRED; Regelverstoss → FAILED (in execute).
  const source = await loadShift(ctx, swap.source_shift_id).catch(() => null);
  const target = swap.target_shift_id ? await loadShift(ctx, swap.target_shift_id).catch(() => null) : null;
  if (
    !source ||
    source.version !== Number(swap.source_shift_version) ||
    (swap.target_shift_id && (!target || target.version !== Number(swap.target_shift_version))) ||
    Date.parse(source.plannedStart) <= Date.now()
  ) {
    await setStatus(ctx, swap, "EXPIRED", {
      code: "EXPIRED",
      message: "Die Dienste haben sich geändert oder liegen in der Vergangenheit.",
    });
    throw new RosterError("EXPIRED", "Der Tausch ist abgelaufen, weil sich die Dienste geändert haben.", 409);
  }
  const rules = await loadRuleSet(ctx, swap.care_unit_id);
  if (rules.autoSwapApproval) return { status: await execute(ctx, swap, null) };
  const snapshot = unitScope(swap.care_unit_id)(
    await loadSnapshot(ctx, {
      unitId: swap.care_unit_id,
      from: source.date,
      to: target?.date ?? source.date,
      employeeIds: [swap.requester_id, swap.target_employee_id],
    }),
  );
  const violations = validateChanges(snapshot, [
    {
      kind: "swap",
      sourceShiftId: source.id,
      sourceVersion: source.version,
      targetEmployeeId: swap.target_employee_id,
      targetShiftId: target?.id ?? null,
      targetVersion: target?.version ?? null,
    },
  ]);
  if (blocking(violations).length) {
    await setStatus(ctx, swap, "FAILED", { code: "RULE_VIOLATION", message: blocking(violations)[0].message });
    throw new RosterError("FAILED", blocking(violations)[0].message, 409, violations);
  }
  const leads = await resolveRecipients(ctx, { leadsOf: swap.care_unit_id });
  await ctx.sql.transaction([
    ctx.sql`WITH changed AS (UPDATE carecore_shift_swaps SET status = 'PENDING_APPROVAL', responded_at = NOW(), updated_at = NOW()
        WHERE id = ${swap.id} AND status = 'PENDING_TARGET' RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'SWAP_CHANGED')`,
    auditQuery(ctx, {
      action: "accepted",
      entityType: "swap",
      entityId: swap.id,
      unitId: swap.care_unit_id,
      before: { status: "PENDING_TARGET" },
      after: { status: "PENDING_APPROVAL" },
      source: "SWAP",
    }),
    notificationQuery(ctx, {
      userId: swap.requester_id,
      type: "SWAP_ACCEPTED",
      title: "Tauschanfrage angenommen",
      message: `${ctx.actor.display_name} hat angenommen. Die Leitung muss den Tausch noch genehmigen.`,
      entityType: "swap",
      entityId: swap.id,
      href: "/c/mein-dienstplan/antraege",
    }),
    ...leads.map((userId) =>
      notificationQuery(ctx, {
        userId,
        type: "SWAP_APPROVAL_NEEDED",
        title: "Diensttausch zur Genehmigung",
        message: `Diensttausch ${describeSwap(snapshot, swap)} wartet auf Genehmigung.`,
        entityType: "swap",
        entityId: swap.id,
        href: "/c/dienstplan/antraege",
      }),
    ),
  ]);
  return { status: "PENDING_APPROVAL" as const };
}

export async function decideSwap(ctx: RosterContext, id: string, body: Body) {
  const swap = await loadSwap(ctx, id);
  if (body.action === "withdraw") {
    if (swap.requester_id !== ctx.actor.id) throw notFound("Tausch");
    if (swap.status !== "PENDING_TARGET")
      throw invalid("Nur Anfragen, die noch nicht beantwortet sind, können zurückgezogen werden.");
    await setStatus(ctx, swap, "WITHDRAWN");
    return { status: "WITHDRAWN" as const };
  }
  requirePermission(ctx, "diensttausch:approve", swap.care_unit_id);
  if (swap.status !== "PENDING_APPROVAL") throw invalid("Dieser Tausch wartet nicht auf eine Genehmigung.");
  if (body.action === "approve") return { status: await execute(ctx, swap, ctx.actor.id) };
  if (body.action !== "reject") throw invalid("Unbekannte Aktion.");
  const { reason } = acknowledgement(body);
  const comment = text(body.comment, "Begründung", 500) ?? reason;
  await setStatus(ctx, swap, "REJECTED", {
    code: "REJECTED",
    message: comment ?? undefined,
    statements: [swap.requester_id, swap.target_employee_id].map((userId) =>
      notificationQuery(ctx, {
        userId,
        type: "SWAP_REJECTED",
        title: "Diensttausch abgelehnt",
        message: `Die Leitung hat den Diensttausch abgelehnt${comment ? `: ${comment}` : "."}`,
        entityType: "swap",
        entityId: swap.id,
        href: "/c/mein-dienstplan/antraege",
      }),
    ),
  });
  return { status: "REJECTED" as const };
}

// Laufende Anfragen, deren Dienste sich geändert haben oder vorbei sind, laufen ab (beim Laden geprüft).
export async function expireStaleSwaps(ctx: RosterContext) {
  await ctx.sql`
    UPDATE carecore_shift_swaps sw SET status = 'EXPIRED', failure_code = 'EXPIRED',
      failure_message = 'Die Dienste haben sich geändert oder liegen in der Vergangenheit.', updated_at = NOW()
    FROM carecore_roster_shifts s
    WHERE sw.organization_id = ${ctx.actor.organizationId} AND sw.status IN ('PENDING_TARGET', 'PENDING_APPROVAL') AND s.id = sw.source_shift_id
      AND (s.version <> sw.source_shift_version OR s.planned_start <= NOW()
        OR (sw.target_shift_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM carecore_roster_shifts t WHERE t.id = sw.target_shift_id AND t.version = sw.target_shift_version)))`;
}

export type SwapView = {
  id: string;
  status: SwapStatus;
  requesterId: string;
  requester: string;
  targetId: string;
  target: string;
  sourceShift: string;
  targetShift: string | null;
  message: string | null;
  requestedAt: string;
  executedAt: string | null;
  failureMessage: string | null;
  mine: "requester" | "target" | null;
};

export async function listSwaps(ctx: RosterContext, scope: { unitId?: string | null; own?: boolean }) {
  await expireStaleSwaps(ctx);
  if (scope.unitId && !scope.own) requirePermission(ctx, "diensttausch:approve", scope.unitId);
  const rows = (await ctx.sql`
    SELECT sw.*, r.display_name AS requester, t.display_name AS target,
      st.name AS source_type, to_char(ss.date, 'YYYY-MM-DD') AS source_date, ss.planned_start AS source_start, ss.planned_end AS source_end,
      tt.name AS target_type, to_char(ts.date, 'YYYY-MM-DD') AS target_date, ts.planned_start AS target_start, ts.planned_end AS target_end,
      rs.timezone
    FROM carecore_shift_swaps sw
    JOIN carecore_users r ON r.id = sw.requester_id JOIN carecore_users t ON t.id = sw.target_employee_id
    JOIN carecore_roster_shifts ss ON ss.id = sw.source_shift_id JOIN carecore_shift_types st ON st.id = ss.shift_type_id
    LEFT JOIN carecore_roster_shifts ts ON ts.id = sw.target_shift_id LEFT JOIN carecore_shift_types tt ON tt.id = ts.shift_type_id
    CROSS JOIN LATERAL (SELECT timezone FROM carecore_rule_sets WHERE organization_id = sw.organization_id AND care_unit_id IS NULL LIMIT 1) rs
    WHERE sw.organization_id = ${ctx.actor.organizationId}
      AND (${scope.own === true} = FALSE OR sw.requester_id = ${ctx.actor.id} OR sw.target_employee_id = ${ctx.actor.id})
      AND (${scope.unitId ?? null}::uuid IS NULL OR sw.care_unit_id = ${scope.unitId ?? null}::uuid)
    ORDER BY sw.status NOT IN ('PENDING_TARGET', 'PENDING_APPROVAL'), sw.requested_at DESC
    LIMIT 150`) as Row[];
  const label = (type: unknown, day: unknown, start: unknown, end: unknown, tz: string) =>
    `${type} am ${formatDate(String(day))} (${localTime(iso(start) ?? "", tz)}–${localTime(iso(end) ?? "", tz)})`;
  return rows
    .filter((row) => scope.own || !scope.unitId || isLeadOf(ctx.access, String(row.care_unit_id)))
    .map((row): SwapView => ({
      id: String(row.id),
      status: row.status as SwapStatus,
      requesterId: String(row.requester_id),
      requester: String(row.requester),
      targetId: String(row.target_employee_id),
      target: String(row.target),
      sourceShift: label(
        row.source_type,
        row.source_date,
        row.source_start,
        row.source_end,
        String(row.timezone ?? "Europe/Zurich"),
      ),
      targetShift: row.target_type
        ? label(
            row.target_type,
            row.target_date,
            row.target_start,
            row.target_end,
            String(row.timezone ?? "Europe/Zurich"),
          )
        : null,
      message: row.message ? String(row.message) : null,
      requestedAt: iso(row.requested_at) ?? "",
      executedAt: iso(row.executed_at),
      failureMessage: row.failure_message ? String(row.failure_message) : null,
      mine:
        String(row.requester_id) === ctx.actor.id
          ? "requester"
          : String(row.target_employee_id) === ctx.actor.id
            ? "target"
            : null,
    }));
}
