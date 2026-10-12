import { ApiError, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";

export type StaffOption = { id: string; name: string };

// Mitarbeitende, die die Administration für die Leitung von Angeboten (Alltagsgestaltung und Aktivierung) zuteilt.
// Gespeichert als Liste von Personen in den Einstellungen der Einrichtung; nur aktive Personen erscheinen.
async function activeStaff(ctx: Pick<ApiContext, "sql" | "actor">): Promise<StaffOption[]> {
  const rows = (await ctx.sql`
    SELECT u.id, u.display_name FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active AND u.archived_at IS NULL
    ORDER BY u.display_name`) as Row[];
  return rows.map((row) => ({ id: String(row.id), name: String(row.display_name) }));
}

async function assignedIds(ctx: Pick<ApiContext, "sql" | "actor">) {
  const rows = (await ctx.sql`
    SELECT settings->'activityLeaders' AS ids FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const ids = rows[0]?.ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export async function activityLeaders(ctx: Pick<ApiContext, "sql" | "actor">): Promise<StaffOption[]> {
  const ids = new Set(await assignedIds(ctx));
  return (await activeStaff(ctx)).filter((person) => ids.has(person.id));
}

export async function activityLeaderSettings(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage")) throw new ApiError("Keine Berechtigung.", 403);
  const [staff, leaders] = await Promise.all([activeStaff(ctx), activityLeaders(ctx)]);
  return { staff, leaders };
}

export async function saveActivityLeaders(ctx: ApiContext, body: Record<string, unknown>) {
  if (!hasPermission(ctx.actor, "administration.manage")) throw new ApiError("Keine Berechtigung.", 403);
  if (!Array.isArray(body.leaderIds) || !body.leaderIds.every((id) => typeof id === "string"))
    throw new ApiError("Bitte die Personen angeben.");
  const staff = await activeStaff(ctx);
  const known = new Set(staff.map((person) => person.id));
  const ids = [...new Set(body.leaderIds as string[])];
  if (ids.some((id) => !known.has(id))) throw new ApiError("Eine gewählte Person ist nicht (mehr) aktiv.");
  const before = await activityLeaders(ctx);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_organizations
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{activityLeaders}', ${JSON.stringify(ids)}::jsonb),
        updated_at = NOW()
      WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(
      ctx,
      "setting",
      ctx.actor.organizationId,
      "activity_leaders",
      { leaders: before.map((person) => person.name) },
      { leaders: staff.filter((person) => ids.includes(person.id)).map((person) => person.name) },
    ),
  ]);
  return activityLeaderSettings(ctx);
}
