import "server-only";
import type { Row } from "@/lib/api-context";
import { auditQuery, notifyAll } from "./audit";
import type { RosterContext } from "./context";
import { requirePermission } from "./context";
import { loadSnapshot, mapPeriod, monthRange } from "./data";
import { RosterError, invalid, notFound } from "./errors";
import { analyzeSchedule, blocking, unacknowledged } from "./rules";
import { acknowledgement, int, uuid, type Body } from "./schemas";
import { monthLabel } from "./time";

// Entwurf/Veröffentlichung (Spec 8.4) und Monatsabschluss der Zeiterfassung (Spec 8.9).

async function loadPeriod(ctx: RosterContext, periodId: string) {
  const rows = (await ctx.sql`
    SELECT * FROM carecore_schedule_periods WHERE id = ${periodId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw notFound("Dienstplan");
  return mapPeriod(rows[0]);
}

const versionCheck = (ctx: RosterContext, periodId: string, version: number) => ctx.sql`
  SELECT carecore_assert(EXISTS (SELECT 1 FROM carecore_schedule_periods WHERE id = ${periodId} AND version = ${version}), 'PERIOD_CHANGED')`;

export async function periodAction(ctx: RosterContext, periodIdInput: string, body: Body) {
  const period = await loadPeriod(ctx, uuid(periodIdInput, "Dienstplan"));
  const action = body.action;
  const expected = int(body.expectedVersion ?? period.version, "Version", 0, 1_000_000);
  if (expected !== period.version)
    throw new RosterError("STALE_VERSION", "Der Monat wurde inzwischen geändert. Bitte neu laden.", 409);
  const label = monthLabel(period.year, period.month);
  const base = { entityType: "period", entityId: period.id, unitId: period.unitId };

  if (action === "publish") {
    requirePermission(ctx, "dienstplan:publish", period.unitId);
    if (period.status === "PUBLISHED") throw invalid(`${label} ist bereits veröffentlicht.`);
    const { from, to } = monthRange(period.year, period.month);
    const snapshot = await loadSnapshot(ctx, { unitId: period.unitId, from, to });
    const violations = analyzeSchedule(snapshot, period.year, period.month);
    const blocks = blocking(violations);
    if (blocks.length)
      throw new RosterError(
        "RULE_VIOLATION",
        `Veröffentlichen nicht möglich: ${blocks.length} ${blocks.length === 1 ? "Regelverstoss muss" : "Regelverstösse müssen"} zuerst behoben werden.`,
        422,
        violations,
      );
    const { acknowledged, reason } = acknowledgement(body);
    if (unacknowledged(violations, acknowledged).length)
      throw new RosterError(
        "CONFIRMATION_REQUIRED",
        "Offene Warnungen (z. B. Unterbesetzung) bitte mit Begründung bestätigen.",
        409,
        violations,
      );
    const recipients = [
      ...new Set(
        snapshot.shifts
          .filter((s) => s.unitId === period.unitId && s.date >= from && s.date <= to)
          .map((s) => s.employeeId),
      ),
    ].filter((id) => id !== ctx.actor.id);
    await ctx.sql.transaction([
      versionCheck(ctx, period.id, period.version),
      ctx.sql`UPDATE carecore_schedule_periods SET status = 'PUBLISHED', published_at = NOW(), published_by = ${ctx.actor.id},
        version = version + 1, updated_at = NOW() WHERE id = ${period.id}`,
      auditQuery(ctx, {
        ...base,
        action: "published",
        before: { status: period.status },
        after: { status: "PUBLISHED", acknowledgedWarnings: acknowledged },
        reason,
      }),
      ...notifyAll(ctx, recipients, {
        type: "SCHEDULE_PUBLISHED",
        title: `Dienstplan ${label} veröffentlicht`,
        message: `Der Dienstplan für ${label} ist veröffentlicht. Bitte deine Dienste ansehen.`,
        entityType: "period",
        entityId: period.id,
        href: `/c/mein-dienstplan?monat=${period.year}-${String(period.month).padStart(2, "0")}`,
      }),
    ]);
    return { status: "PUBLISHED" as const, violations: violations.filter((v) => v.severity !== "BLOCK") };
  }

  if (action === "revert") {
    requirePermission(ctx, "dienstplan:publish", period.unitId);
    if (period.status !== "PUBLISHED") throw invalid(`${label} ist bereits ein Entwurf.`);
    const { from, to } = monthRange(period.year, period.month);
    const entries = (await ctx.sql`
      SELECT 1 FROM carecore_time_entries WHERE care_unit_id = ${period.unitId} AND date BETWEEN ${from}::date AND ${to}::date LIMIT 1`) as Row[];
    if (entries[0])
      throw new RosterError(
        "HAS_TIME_ENTRIES",
        `${label} hat bereits Zeiteinträge und kann nicht mehr zum Entwurf werden.`,
        409,
      );
    await ctx.sql.transaction([
      versionCheck(ctx, period.id, period.version),
      ctx.sql`UPDATE carecore_schedule_periods SET status = 'DRAFT', version = version + 1, updated_at = NOW() WHERE id = ${period.id}`,
      auditQuery(ctx, {
        ...base,
        action: "reverted_to_draft",
        before: { status: "PUBLISHED" },
        after: { status: "DRAFT" },
      }),
    ]);
    return { status: "DRAFT" as const, violations: [] };
  }

  if (action === "lock" || action === "unlock") {
    requirePermission(ctx, "zeiterfassung:lock", period.unitId);
    if (action === "lock" && period.lockedAt) throw invalid(`${label} ist bereits abgeschlossen.`);
    if (action === "unlock" && !period.lockedAt) throw invalid(`${label} ist nicht abgeschlossen.`);
    const reason = action === "unlock" ? String(body.reason ?? "").trim() : null;
    if (action === "unlock" && !reason) throw invalid("Bitte begründen, warum der Monat wieder geöffnet wird.");
    if (action === "lock") {
      const { from, to } = monthRange(period.year, period.month);
      const open = (await ctx.sql`
        SELECT COUNT(*)::int AS n FROM carecore_time_entries
        WHERE care_unit_id = ${period.unitId} AND date BETWEEN ${from}::date AND ${to}::date AND status IN ('OPEN', 'INCOMPLETE')`) as Row[];
      if (Number(open[0]?.n ?? 0) > 0)
        throw new RosterError(
          "OPEN_ENTRIES",
          `${label} hat noch ${open[0].n} offene oder unvollständige Zeiteinträge. Bitte zuerst korrigieren.`,
          409,
        );
    }
    await ctx.sql.transaction([
      versionCheck(ctx, period.id, period.version),
      action === "lock"
        ? ctx.sql`UPDATE carecore_schedule_periods SET locked_at = NOW(), locked_by = ${ctx.actor.id}, version = version + 1, updated_at = NOW()
            WHERE id = ${period.id}`
        : ctx.sql`UPDATE carecore_schedule_periods SET locked_at = NULL, locked_by = NULL, version = version + 1, updated_at = NOW()
            WHERE id = ${period.id}`,
      ...(action === "lock"
        ? [
            ctx.sql`UPDATE carecore_time_entries SET status = 'APPROVED', version = version + 1, updated_at = NOW()
              WHERE care_unit_id = ${period.unitId} AND status = 'COMPLETE'
                AND date BETWEEN ${monthRange(period.year, period.month).from}::date AND ${monthRange(period.year, period.month).to}::date`,
          ]
        : []),
      auditQuery(ctx, {
        ...base,
        action: action === "lock" ? "locked" : "reopened",
        before: { lockedAt: period.lockedAt },
        after: { locked: action === "lock" },
        reason,
      }),
    ]);
    return { status: period.status, violations: [] };
  }
  throw invalid("Unbekannte Aktion.");
}
