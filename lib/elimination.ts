import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { capturedAt, receiptStatements, withReceipt } from "@/lib/request-receipts";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import { readSettings } from "@/lib/settings";
import {
  ELIMINATION_AMOUNTS,
  ELIMINATION_KINDS,
  type EliminationAmount,
  type EliminationKind,
  type EliminationView,
} from "@/lib/elimination-shared";

// Ausscheidungs- und Kontinenzprotokoll: Beobachtungen, keine Bewertung. Der Hinweis „kein Stuhlgang seit …“ erscheint
// nur, wenn die Einrichtung die Tageszahl festgelegt hat, und nur für Personen, für die das Protokoll geführt wird.

const DAYS = [3, 7, 14] as const;
const STOOL_KINDS = ["stool", "incontinence_stool"];

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "documentation.write")) throw new ApiError("Keine Berechtigung.", 403);
}

async function reminderDays(ctx: ApiContext) {
  const setting = (await readSettings(ctx)).stoolReminderDays;
  return setting.enabled && setting.value ? setting.value : null;
}

export async function eliminationView(
  ctx: ApiContext,
  residentInput: unknown,
  daysInput: unknown,
): Promise<EliminationView> {
  const residentId = await assertResident(ctx, residentInput);
  const days = DAYS.find((value) => value === Number(daysInput)) ?? 3;
  const [entries, last] = (await Promise.all([
    ctx.sql`
      SELECT e.id, e.occurred_at, e.kind, e.bristol, e.volume, e.material, e.note,
        COALESCE(u.display_name, 'Unbekannt') AS author, e.cancelled_at, COALESCE(c.display_name, 'Unbekannt') AS cancelled_by,
        e.cancel_reason
      FROM carecore_elimination_entries e
      LEFT JOIN carecore_users u ON u.id = e.author_user_id
      LEFT JOIN carecore_users c ON c.id = e.cancelled_by
      WHERE e.resident_id = ${residentId} AND e.occurred_at > NOW() - make_interval(days => ${days})
      ORDER BY e.occurred_at DESC LIMIT 500`,
    ctx.sql`
      SELECT MAX(e.occurred_at) AS last_at,
        ((NOW() AT TIME ZONE o.timezone)::date - (MAX(e.occurred_at) AT TIME ZONE o.timezone)::date) AS days
      FROM carecore_elimination_entries e JOIN carecore_organizations o ON o.id = e.organization_id
      WHERE e.resident_id = ${residentId} AND e.cancelled_at IS NULL AND e.kind = ANY(${STOOL_KINDS})
      GROUP BY o.timezone`,
  ])) as Row[][];
  const reminder = await reminderDays(ctx);
  const since = last[0] ? Number(last[0].days) : null;
  return {
    residentId,
    canWrite: hasPermission(ctx.actor, "documentation.write"),
    lastStoolAt: last[0] ? iso(last[0].last_at) : null,
    daysSinceStool: since,
    reminderDays: reminder,
    overdue: reminder !== null && since !== null && since >= reminder,
    entries: entries.map((row) => ({
      id: String(row.id),
      occurredAt: iso(row.occurred_at) ?? "",
      kind: row.kind as EliminationKind,
      bristol: row.bristol === null ? null : Number(row.bristol),
      volume: (row.volume as EliminationAmount | null) ?? null,
      material: String(row.material),
      note: String(row.note),
      author: String(row.author),
      cancelled: row.cancelled_at
        ? { at: iso(row.cancelled_at) ?? "", by: String(row.cancelled_by), reason: String(row.cancel_reason) }
        : null,
    })),
    days,
  };
}

// Eintrag erfassen (auch offline vorgemerkt: Zeitpunkt der Erfassung, Quittung gegen doppelte Einträge).
export async function createEliminationEntry(
  ctx: ApiContext,
  body: Record<string, unknown>,
  requestId: string | null = null,
) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const kind = String(body.kind ?? "") as EliminationKind;
  if (!(kind in ELIMINATION_KINDS)) throw new ApiError("Bitte die Art wählen.");
  const bristol =
    body.bristol === null || body.bristol === undefined || body.bristol === "" ? null : Number(body.bristol);
  if (bristol !== null && (!Number.isInteger(bristol) || bristol < 1 || bristol > 7))
    throw new ApiError("Die Stuhlform ist ungültig (Typ 1 bis 7).");
  if (bristol !== null && !STOOL_KINDS.includes(kind)) throw new ApiError("Die Stuhlform gehört nur zum Stuhlgang.");
  const volume = body.volume ? (String(body.volume) as EliminationAmount) : null;
  if (volume !== null && !(volume in ELIMINATION_AMOUNTS)) throw new ApiError("Die Menge ist ungültig.");
  const material = text(body.material, 200);
  if (kind === "material" && !material) throw new ApiError("Bitte das Material angeben.");
  const note = text(body.note, 2000);
  const occurredAt = capturedAt(body.occurredAt) ?? new Date().toISOString();
  const id = randomUUID();
  const { repeated } = await withReceipt(() =>
    ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_elimination_entries (id, organization_id, resident_id, occurred_at, kind, bristol, volume,
          material, note, author_user_id)
        VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${occurredAt}, ${kind}, ${bristol}, ${volume},
          ${material}, ${note}, ${ctx.actor.id})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "elimination_entry",
        entityId: id,
        action: "created",
        after: { kind, bristol, volume, occurredAt },
      }),
      ...receiptStatements(ctx, requestId),
    ]),
  );
  return { id: repeated ? null : id };
}

// Stornieren statt löschen: der Eintrag bleibt sichtbar, mit Grund.
export async function cancelEliminationEntry(ctx: ApiContext, entryInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const entryId = assertUuid(entryInput, "Eintrag");
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  const [entry] = (await ctx.sql`
    SELECT id, resident_id, cancelled_at FROM carecore_elimination_entries
    WHERE id = ${entryId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!entry) throw new ApiError("Eintrag nicht gefunden.", 404);
  if (entry.cancelled_at) throw new ApiError("Der Eintrag ist bereits storniert.", 409);
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_elimination_entries SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id},
          cancel_reason = ${reason} WHERE id = ${entryId} AND cancelled_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ENTRY_CANCELLED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(entry.resident_id),
        entityType: "elimination_entry",
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

// Für die Tagesliste: Personen mit Protokoll, deren letzter Stuhlgang mindestens die festgelegte Tageszahl zurückliegt.
export async function dueStool(ctx: ApiContext) {
  const days = await reminderDays(ctx);
  if (!days) return [] as Row[];
  return (await ctx.sql`
    WITH last AS (
      SELECT e.resident_id,
        MAX(e.occurred_at) FILTER (WHERE e.kind = ANY(${STOOL_KINDS}) AND e.cancelled_at IS NULL) AS last_stool,
        MIN(e.occurred_at) AS first_entry
      FROM carecore_elimination_entries e
      JOIN carecore_residents r ON r.id = e.resident_id AND r.organization_id = ${ctx.actor.organizationId}
      WHERE r.status = 'active'
      GROUP BY e.resident_id)
    SELECT l.resident_id, ${days}::int AS days,
      ((NOW() AT TIME ZONE o.timezone)::date - (COALESCE(l.last_stool, l.first_entry) AT TIME ZONE o.timezone)::date) AS since,
      l.last_stool IS NULL AS never
    FROM last l CROSS JOIN carecore_organizations o
    WHERE o.id = ${ctx.actor.organizationId}
      AND ((NOW() AT TIME ZONE o.timezone)::date - (COALESCE(l.last_stool, l.first_entry) AT TIME ZONE o.timezone)::date) >= ${days}`) as Row[];
}
