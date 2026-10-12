import { ApiError, auditStatement, text, type ApiContext } from "@/lib/api-context";
import { EVENT_TYPES } from "@/lib/quality-shared";
import { hasPermission } from "@/lib/server-data";

// Ereignisarten: die eingebauten (Kennzahlen wie Sturzereignisse beruhen darauf) und eigene der Einrichtung,
// gespeichert in carecore_organizations.settings.eventTypes.

export const CUSTOM_EVENT_TYPES_MAX = 20;

const customOf = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export async function readEventTypes(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT settings->'eventTypes' AS types FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Array<{
    types: unknown;
  }>;
  const custom = customOf(rows[0]?.types);
  return { builtIn: [...EVENT_TYPES] as string[], custom, all: [...EVENT_TYPES, ...custom] as string[] };
}

export async function assertEventType(ctx: ApiContext, value: unknown, message: string) {
  const type = typeof value === "string" ? value : "";
  if (!(await readEventTypes(ctx)).all.includes(type)) throw new ApiError(message);
  return type;
}

// Eigene Ereignisarten ersetzen (Qualitätsmanagement). Entfernte Arten nehmen ihre Ablaufkette mit; gemeldete
// Ereignisse behalten ihre Art.
export async function saveEventTypes(ctx: ApiContext, input: unknown) {
  if (!hasPermission(ctx.actor, "quality.manage"))
    throw new ApiError("Ereignisarten legt das Qualitätsmanagement fest.", 403);
  if (!Array.isArray(input)) throw new ApiError("Bitte die Ereignisarten als Liste angeben.");
  const custom = input.map((item) => text(item, 80));
  if (custom.length > CUSTOM_EVENT_TYPES_MAX)
    throw new ApiError(`Höchstens ${CUSTOM_EVENT_TYPES_MAX} eigene Ereignisarten.`);
  const seen = new Set<string>((EVENT_TYPES as readonly string[]).map((type) => type.toLocaleLowerCase("de-CH")));
  for (const type of custom) {
    if (type.length < 3) throw new ApiError("Bitte jede Ereignisart mit mindestens 3 Zeichen benennen.");
    const key = type.toLocaleLowerCase("de-CH");
    if (seen.has(key)) throw new ApiError(`„${type}“ gibt es bereits.`);
    seen.add(key);
  }
  const before = (await readEventTypes(ctx)).custom;
  const removed = before.filter((type) => !custom.includes(type));
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_organizations
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{eventTypes}', ${JSON.stringify(custom)}::jsonb), updated_at = NOW()
      WHERE id = ${ctx.actor.organizationId}`,
    ctx.sql`
      DELETE FROM carecore_event_workflow_steps
      WHERE organization_id = ${ctx.actor.organizationId} AND event_type = ANY(${removed}::text[])`,
    auditStatement(ctx, "event_types", ctx.actor.organizationId, "updated", { custom: before }, { custom }),
  ]);
  return custom;
}
