import "server-only";
import type { Row } from "@/lib/api-context";
import { iso } from "@/lib/api-context";
import type { RosterContext } from "./context";
import { requirePermission } from "./context";
import { managedUnitIds } from "./permissions";
import { optionalDate, optionalUuid, text } from "./schemas";

// Ansicht des Audit-Logs für die Leitung (Spec 8.12): filterbar nach Person, Zeitraum, Aktion;
// pro Dienst der Verlauf.

export type AuditEntry = {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  unitId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  source: string;
  correlationId: string;
};

export async function listAudit(ctx: RosterContext, params: URLSearchParams) {
  const unitId = optionalUuid(params.get("einheit"), "Wohnbereich");
  if (unitId) requirePermission(ctx, "audit:read", unitId);
  else if (!managedUnitIds(ctx.access).length) requirePermission(ctx, "audit:read");
  const units = unitId ? [unitId] : managedUnitIds(ctx.access);
  const shiftId = optionalUuid(params.get("dienst"), "Dienst");
  const actor = optionalUuid(params.get("person"), "Person");
  const from = optionalDate(params.get("von"), "Von");
  const to = optionalDate(params.get("bis"), "Bis");
  const action = text(params.get("aktion"), "Aktion", 60);
  const rows = (await ctx.sql`
    SELECT id, created_at, actor_label, action, entity_type, entity_id, care_unit_id, before_data, after_data, reason, source, correlation_id
    FROM carecore_roster_audit
    WHERE organization_id = ${ctx.actor.organizationId}
      AND (care_unit_id = ANY(${units}::uuid[]) OR (care_unit_id IS NULL AND ${ctx.access.isAdmin || units.length > 0}))
      AND (${shiftId}::uuid IS NULL OR entity_id = ${shiftId}::uuid)
      AND (${actor}::uuid IS NULL OR actor_id = ${actor}::uuid
        OR before_data->>'employeeId' = ${actor}::text OR after_data->>'employeeId' = ${actor}::text)
      AND (${from}::date IS NULL OR created_at >= ${from}::date)
      AND (${to}::date IS NULL OR created_at < ${to}::date + 1)
      AND (${action}::text IS NULL OR action = ${action}::text)
    ORDER BY created_at DESC
    LIMIT 300`) as Row[];
  return rows.map((row): AuditEntry => ({
    id: String(row.id),
    createdAt: iso(row.created_at) ?? "",
    actor: String(row.actor_label),
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: row.entity_id ? String(row.entity_id) : null,
    unitId: row.care_unit_id ? String(row.care_unit_id) : null,
    before: row.before_data ?? null,
    after: row.after_data ?? null,
    reason: row.reason ? String(row.reason) : null,
    source: String(row.source),
    correlationId: String(row.correlation_id),
  }));
}
