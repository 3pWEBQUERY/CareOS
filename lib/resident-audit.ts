import { randomUUID } from "node:crypto";
import type { carecoreDb } from "./server-data";
import { auditOrigin } from "@/lib/audit-origin";

type Sql = ReturnType<typeof carecoreDb>;
type Actor = { id: string; organizationId?: string | null };

// Protokolleintrag zu einer Änderung an der Bewohnerakte. Die Abfrage wird nicht ausgeführt, sondern
// zusammen mit der Änderung in `sql.transaction([...])` gegeben, damit beides gemeinsam gelingt oder scheitert.
// `residentId` steht immer in den Daten, damit das Änderungsprotokoll einer Akte alle Einträge findet.
export function residentAudit(
  sql: Sql,
  actor: Actor,
  entry: {
    residentId: string;
    entityType: string;
    entityId: string;
    action: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
) {
  const before = entry.before ? JSON.stringify({ residentId: entry.residentId, ...entry.before }) : null;
  const after = JSON.stringify({ residentId: entry.residentId, ...(entry.after ?? {}) });
  return sql`
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, before_data, after_data)
    VALUES (${randomUUID()}, ${actor.organizationId ?? null}, ${actor.id}, ${auditOrigin(actor).sessionId}, ${auditOrigin(actor).userAgent}, ${entry.entityType}, ${entry.entityId}, ${entry.action},
      ${before}::jsonb, ${after}::jsonb)`;
}

// Felder, deren Inhalt sich geändert hat (für sensible Texte wie die Biografie wird nur das protokolliert).
export function changedFields(before: Record<string, unknown> | undefined, after: Record<string, unknown>) {
  const normalize = (value: unknown) => (value === "" || value === undefined ? null : value);
  return Object.keys(after).filter((key) => normalize(before?.[key]) !== normalize(after[key]));
}
