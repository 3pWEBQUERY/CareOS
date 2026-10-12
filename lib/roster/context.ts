import "server-only";
import { randomUUID } from "node:crypto";
import type { ApiContext, Row } from "@/lib/api-context";
import { carecoreActor, carecoreDb, hasPermission, type CarecoreActor } from "@/lib/server-data";
import { RosterError, forbidden, notFound } from "./errors";
import { rosterCan, visibleUnitIds, type RosterAccess, type RosterPermission } from "./permissions";

// Jeder Dienstplan-Endpunkt holt sich damit Anmeldung, Organisation und Scope selbst (Spec 6.2).
export type RosterContext = ApiContext & { access: RosterAccess; correlationId: string };

export async function accessFor(sql: ApiContext["sql"], actor: CarecoreActor & { organizationId: string }) {
  const rows = (await sql`
    SELECT cu.id, COALESCE(m.plannable, FALSE) AS plannable, COALESCE(m.is_lead, FALSE) AS is_lead
    FROM carecore_care_units cu
    JOIN carecore_sites si ON si.id = cu.site_id
    LEFT JOIN carecore_unit_memberships m ON m.care_unit_id = cu.id AND m.user_id = ${actor.id}
    LEFT JOIN carecore_user_profiles p ON p.user_id = ${actor.id}
    WHERE si.organization_id = ${actor.organizationId} AND cu.active = TRUE
    -- Stammwohnbereich zuerst: er ist die Vorauswahl in Teamplan, Planung und Zeiterfassung.
    ORDER BY cu.id = p.primary_care_unit_id DESC NULLS LAST, si.name, cu.name`) as Row[];
  return {
    userId: actor.id,
    isAdmin: hasPermission(actor, "administration.manage"),
    canManage: hasPermission(actor, "schedule.manage"),
    leadUnitIds: rows.filter((row) => row.is_lead).map((row) => String(row.id)),
    memberUnitIds: rows.filter((row) => row.plannable).map((row) => String(row.id)),
    allUnitIds: rows.map((row) => String(row.id)),
  } satisfies RosterAccess;
}

export async function rosterContext(): Promise<RosterContext> {
  const actor = await carecoreActor();
  if (!actor) throw new RosterError("UNAUTHENTICATED", "Bitte erneut anmelden.", 401);
  if (!actor.organizationId) throw new RosterError("NO_ORGANIZATION", "Keine Organisation zugeordnet.", 400);
  const sql = carecoreDb();
  const scoped = actor as CarecoreActor & { organizationId: string };
  return { actor: scoped, sql, access: await accessFor(sql, scoped), correlationId: randomUUID() };
}

// Für bestehende Endpunkte mit ApiContext (z. B. „Mein Dienst“), die Dienstplan-Services nutzen.
export async function rosterContextFrom(ctx: ApiContext): Promise<RosterContext> {
  return { ...ctx, access: await accessFor(ctx.sql, ctx.actor), correlationId: randomUUID() };
}

// Fremde Wohnbereiche verraten ihre Existenz nicht (NOT_FOUND); im eigenen Bereich fehlt das Recht (FORBIDDEN).
export function requirePermission(ctx: RosterContext, permission: RosterPermission, unitId?: string | null) {
  if (rosterCan(ctx.access, permission, unitId)) return;
  if (unitId && !visibleUnitIds(ctx.access).includes(unitId)) throw notFound("Wohnbereich");
  throw forbidden();
}

export async function unitName(ctx: RosterContext, unitId: string) {
  const rows = (await ctx.sql`
    SELECT cu.name FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
    WHERE cu.id = ${unitId} AND si.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw notFound("Wohnbereich");
  return String(rows[0].name);
}

export async function unitsFor(ctx: RosterContext, ids: string[]) {
  if (!ids.length) return [];
  const rows = (await ctx.sql`
    SELECT cu.id, cu.name, si.name AS site FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
    WHERE cu.id = ANY(${ids}::uuid[]) AND si.organization_id = ${ctx.actor.organizationId}
    ORDER BY si.name, cu.name`) as Row[];
  return rows.map((row) => ({ id: String(row.id), name: String(row.name), site: String(row.site) }));
}
