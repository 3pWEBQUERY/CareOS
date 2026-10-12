import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { capturedAt, receiptStatements, withReceipt } from "@/lib/request-receipts";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  POSITIONS,
  SKIN_FINDINGS,
  type Position,
  type RepositioningView,
  type SkinFinding,
} from "@/lib/repositioning-shared";

// Lagerungs- und Bewegungsprotokoll: Positionswechsel mit Hautbefund. Das Intervall legt eine Fachperson fest (aus der
// Pflegeplanung); CareOS errechnet daraus nur den nächsten Wechsel und gibt keine eigenen Intervalle vor.

const HOURS = [24, 72, 168] as const;

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "documentation.write")) throw new ApiError("Keine Berechtigung.", 403);
}

export async function repositioningView(
  ctx: ApiContext,
  residentInput: unknown,
  hoursInput: unknown,
): Promise<RepositioningView> {
  const residentId = await assertResident(ctx, residentInput);
  const hours = HOURS.find((value) => value === Number(hoursInput)) ?? 24;
  const [plans, entries, interventions] = (await Promise.all([
    ctx.sql`
      SELECT p.id, p.interval_minutes, p.intervention_id, i.title AS intervention, p.note, p.created_at,
        COALESCE(u.display_name, 'Unbekannt') AS created_by,
        (SELECT MAX(performed_at) FROM carecore_repositioning_entries e
          WHERE e.resident_id = p.resident_id AND e.cancelled_at IS NULL) AS last_at
      FROM carecore_repositioning_plans p
      LEFT JOIN carecore_interventions i ON i.id = p.intervention_id
      LEFT JOIN carecore_users u ON u.id = p.created_by
      WHERE p.resident_id = ${residentId} AND p.ended_at IS NULL`,
    ctx.sql`
      SELECT e.id, e.performed_at, e.position, e.skin, e.note, COALESCE(u.display_name, 'Unbekannt') AS author,
        e.cancelled_at, COALESCE(c.display_name, 'Unbekannt') AS cancelled_by, e.cancel_reason
      FROM carecore_repositioning_entries e
      LEFT JOIN carecore_users u ON u.id = e.author_user_id
      LEFT JOIN carecore_users c ON c.id = e.cancelled_by
      WHERE e.resident_id = ${residentId} AND e.performed_at > NOW() - make_interval(hours => ${hours})
      ORDER BY e.performed_at DESC LIMIT 500`,
    ctx.sql`
      SELECT i.id, i.title, COALESCE(i.frequency, '') AS frequency
      FROM carecore_interventions i
      JOIN carecore_care_goals g ON g.id = i.care_goal_id
      JOIN carecore_care_plans p ON p.id = g.care_plan_id
      WHERE p.resident_id = ${residentId} AND p.status IN ('draft', 'active', 'review') AND i.status = 'active'
      ORDER BY i.title`,
  ])) as Row[][];
  const plan = plans[0];
  const lastAt = plan ? iso(plan.last_at) : null;
  const base = lastAt ?? (plan ? iso(plan.created_at) : null);
  const nextDueAt =
    plan && base ? new Date(Date.parse(base) + Number(plan.interval_minutes) * 60_000).toISOString() : null;
  return {
    residentId,
    canWrite: hasPermission(ctx.actor, "documentation.write"),
    plan: plan
      ? {
          id: String(plan.id),
          intervalMinutes: Number(plan.interval_minutes),
          interventionId: (plan.intervention_id as string | null) ?? null,
          intervention: (plan.intervention as string | null) ?? null,
          note: String(plan.note),
          createdAt: iso(plan.created_at) ?? "",
          createdBy: String(plan.created_by),
        }
      : null,
    nextDueAt,
    overdue: nextDueAt !== null && Date.parse(nextDueAt) <= Date.now(),
    lastAt,
    interventions: interventions.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      frequency: String(row.frequency),
    })),
    entries: entries.map((row) => ({
      id: String(row.id),
      performedAt: iso(row.performed_at) ?? "",
      position: row.position as Position,
      skin: row.skin as SkinFinding,
      note: String(row.note),
      author: String(row.author),
      cancelled: row.cancelled_at
        ? { at: iso(row.cancelled_at) ?? "", by: String(row.cancelled_by), reason: String(row.cancel_reason) }
        : null,
    })),
    hours,
  };
}

// Plan festlegen oder ändern (neues Intervall ersetzt das bisherige, das mit Grund beendet wird).
export async function saveRepositioningPlan(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const interval = Number(body.intervalMinutes);
  if (!Number.isInteger(interval) || interval < 15 || interval > 1440)
    throw new ApiError("Bitte das Intervall aus der Pflegeplanung angeben (15 Minuten bis 24 Stunden).");
  const interventionId = body.interventionId ? assertUuid(body.interventionId, "Massnahme") : null;
  if (interventionId) {
    const found = (await ctx.sql`
      SELECT 1 FROM carecore_interventions i JOIN carecore_care_goals g ON g.id = i.care_goal_id
      JOIN carecore_care_plans p ON p.id = g.care_plan_id
      WHERE i.id = ${interventionId} AND p.resident_id = ${residentId}`) as Row[];
    if (!found.length) throw new ApiError("Massnahme nicht gefunden.", 404);
  }
  const note = text(body.note, 2000);
  const [current] = (await ctx.sql`
    SELECT id, interval_minutes FROM carecore_repositioning_plans
    WHERE resident_id = ${residentId} AND ended_at IS NULL`) as Row[];
  const id = randomUUID();
  try {
    await ctx.sql.transaction([
      ...(current
        ? [
            ctx.sql`
              UPDATE carecore_repositioning_plans SET ended_at = NOW(), ended_by = ${ctx.actor.id},
                end_reason = 'Durch neuen Plan ersetzt'
              WHERE id = ${current.id} AND ended_at IS NULL`,
          ]
        : []),
      ctx.sql`
        INSERT INTO carecore_repositioning_plans (id, organization_id, resident_id, interval_minutes, intervention_id, note,
          created_by)
        VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${interval}, ${interventionId}, ${note}, ${ctx.actor.id})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "repositioning_plan",
        entityId: id,
        action: current ? "updated" : "created",
        before: current ? { intervalMinutes: Number(current.interval_minutes) } : null,
        after: { intervalMinutes: interval, interventionId },
      }),
    ]);
  } catch (error) {
    if (String(error).includes("carecore_repositioning_plans_active_idx"))
      throw new ApiError("Der Plan wurde inzwischen geändert. Bitte neu laden.", 409);
    throw error;
  }
  return { id };
}

// Plan beenden (z. B. Person wieder selbständig mobil), mit Grund.
export async function endRepositioningPlan(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  const [current] = (await ctx.sql`
    SELECT id FROM carecore_repositioning_plans WHERE resident_id = ${residentId} AND ended_at IS NULL`) as Row[];
  if (!current) throw new ApiError("Es gibt keinen laufenden Lagerungsplan.", 404);
  await ctx.sql
    .transaction([
      ctx.sql`
      WITH changed AS (UPDATE carecore_repositioning_plans SET ended_at = NOW(), ended_by = ${ctx.actor.id},
        end_reason = ${reason} WHERE id = ${current.id} AND ended_at IS NULL RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'PLAN_CHANGED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "repositioning_plan",
        entityId: String(current.id),
        action: "ended",
        after: { reason },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("PLAN_CHANGED")) throw new ApiError("Der Plan wurde inzwischen geändert.", 409);
      throw error;
    });
}

// Positionswechsel erfassen (auch offline vorgemerkt: Zeitpunkt der Erfassung, Quittung gegen doppelte Einträge).
export async function createRepositioningEntry(
  ctx: ApiContext,
  body: Record<string, unknown>,
  requestId: string | null = null,
) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const position = String(body.position ?? "") as Position;
  if (!(position in POSITIONS)) throw new ApiError("Bitte die Position wählen.");
  const skin = String(body.skin ?? "") as SkinFinding;
  if (!(skin in SKIN_FINDINGS)) throw new ApiError("Bitte den Hautbefund wählen.");
  const note = text(body.note, 2000);
  if (position === "other" && !note) throw new ApiError("Bitte die Position in der Bemerkung beschreiben.");
  const performedAt = capturedAt(body.performedAt) ?? new Date().toISOString();
  const id = randomUUID();
  const { repeated } = await withReceipt(() =>
    ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_repositioning_entries (id, organization_id, resident_id, performed_at, position, skin, note,
          author_user_id)
        VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${performedAt}, ${position}, ${skin}, ${note},
          ${ctx.actor.id})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "repositioning_entry",
        entityId: id,
        action: "created",
        after: { position, skin, performedAt },
      }),
      ...receiptStatements(ctx, requestId),
    ]),
  );
  return { id: repeated ? null : id };
}

// Stornieren statt löschen: der Eintrag bleibt sichtbar, mit Grund.
export async function cancelRepositioningEntry(ctx: ApiContext, entryInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const entryId = assertUuid(entryInput, "Eintrag");
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  const [entry] = (await ctx.sql`
    SELECT id, resident_id, cancelled_at FROM carecore_repositioning_entries
    WHERE id = ${entryId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!entry) throw new ApiError("Eintrag nicht gefunden.", 404);
  if (entry.cancelled_at) throw new ApiError("Der Eintrag ist bereits storniert.", 409);
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_repositioning_entries SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id},
          cancel_reason = ${reason} WHERE id = ${entryId} AND cancelled_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ENTRY_CANCELLED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(entry.resident_id),
        entityType: "repositioning_entry",
        entityId: entryId,
        action: "cancelled",
        after: { reason },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("ENTRY_CANCELLED")) throw new ApiError("Der Eintrag ist bereits storniert.", 409);
      throw error;
    });
}

// Für die Tagesliste: laufende Pläne mit dem nächsten Wechsel.
export async function dueRepositioning(ctx: ApiContext) {
  return (await ctx.sql`
    WITH due AS (
      SELECT p.resident_id, p.interval_minutes, o.timezone,
        COALESCE((SELECT MAX(performed_at) FROM carecore_repositioning_entries e
          WHERE e.resident_id = p.resident_id AND e.cancelled_at IS NULL), p.created_at)
          + make_interval(mins => p.interval_minutes) AS due_at
      FROM carecore_repositioning_plans p
      JOIN carecore_residents r ON r.id = p.resident_id AND r.organization_id = ${ctx.actor.organizationId}
      JOIN carecore_organizations o ON o.id = r.organization_id
      WHERE p.ended_at IS NULL AND r.status = 'active')
    SELECT resident_id, interval_minutes, due_at, to_char(due_at AT TIME ZONE timezone, 'HH24:MI') AS time
    FROM due`) as Row[];
}
