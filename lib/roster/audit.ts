import "server-only";
import type { Row } from "@/lib/api-context";
import type { RosterContext } from "./context";
import { notificationTypeKey, type AuditSource, type NotificationType } from "./types";

// Audit-Log (append-only, Spec 8.12) und Benachrichtigungen (Spec 8.11). Beide liefern Anweisungen,
// die in derselben Transaktion wie die fachliche Änderung ausgeführt werden.

export type AuditInput = {
  action: string;
  entityType: string;
  entityId: string | null;
  unitId: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  source?: AuditSource;
  correlationId?: string;
};

const json = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value));

export function auditQuery(ctx: RosterContext, input: AuditInput) {
  return ctx.sql`
    INSERT INTO carecore_roster_audit (organization_id, actor_id, actor_label, action, entity_type, entity_id, care_unit_id,
      before_data, after_data, reason, source, correlation_id)
    VALUES (${ctx.actor.organizationId}, ${input.source === "SYSTEM" ? null : ctx.actor.id},
      ${input.source === "SYSTEM" ? "System" : ctx.actor.display_name}, ${input.action}, ${input.entityType},
      ${input.entityId}, ${input.unitId}, ${json(input.before)}::jsonb, ${json(input.after)}::jsonb,
      ${input.reason ?? null}, ${input.source ?? "UI"}, ${input.correlationId ?? ctx.correlationId})`;
}

export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string;
  entityId: string | null;
  href: string;
  priority?: "normal" | "high" | "critical";
};

export function notificationQuery(ctx: RosterContext, input: NotificationInput) {
  return ctx.sql`
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    VALUES (gen_random_uuid(), ${input.userId}, ${input.title.slice(0, 220)}, ${input.message},
      ${notificationTypeKey(input.type)}, ${input.priority ?? "normal"}, ${input.href}, ${input.entityType}, ${input.entityId})`;
}

// Empfänger zentral bestimmen: Leitungen eines Wohnbereichs und/oder bestimmte Personen, ohne die
// handelnde Person selbst (sie sieht das Ergebnis direkt).
export async function resolveRecipients(
  ctx: RosterContext,
  target: { leadsOf?: string | null; people?: Array<string | null | undefined>; includeActor?: boolean },
) {
  const ids = new Set(target.people?.filter((id): id is string => !!id));
  if (target.leadsOf) {
    const rows = (await ctx.sql`
      SELECT m.user_id FROM carecore_unit_memberships m
      JOIN carecore_users u ON u.id = m.user_id
      JOIN carecore_roles r ON r.key = u.role
      WHERE m.care_unit_id = ${target.leadsOf} AND m.is_lead AND u.active
        AND (r.permissions ? 'schedule.manage' OR r.permissions ? 'administration.manage')`) as Row[];
    for (const row of rows) ids.add(String(row.user_id));
  }
  if (!target.includeActor) ids.delete(ctx.actor.id);
  return [...ids];
}

export function notifyAll(ctx: RosterContext, userIds: string[], input: Omit<NotificationInput, "userId">) {
  return userIds.map((userId) => notificationQuery(ctx, { ...input, userId }));
}
