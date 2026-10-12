import { randomUUID } from "node:crypto";
import { termsFor } from "@/lib/terminology";
import { NextResponse } from "next/server";
import {
  carecoreActor,
  carecoreDb,
  forbidden,
  hasPermission,
  type CarecoreActor,
  type Permission,
} from "@/lib/server-data";
import { schedulePush } from "@/lib/push";
import { scheduleWebhooks } from "@/lib/webhooks";
import { auditOrigin } from "@/lib/audit-origin";
import { recordServerError } from "@/lib/error-log";

// Shared helpers for the module APIs (medication, vital signs, ...).

export type Sql = ReturnType<typeof carecoreDb>;
export type Row = Record<string, unknown>;
export type ApiContext = { actor: CarecoreActor & { organizationId: string }; sql: Sql };

// Thrown for invalid input or violated rules; routes turn it into a 4xx response.
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// Signed-in actor with an organization and the given permission, or the error response to return.
// Ohne `permission` genügt eine Anmeldung mit Organisation (z. B. für das Logo der Einrichtung).
export async function apiContext(permission?: Permission): Promise<ApiContext | NextResponse> {
  const actor = await carecoreActor();
  if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!actor.organizationId) return NextResponse.json({ error: "Keine Organisation zugeordnet." }, { status: 400 });
  if (permission && !hasPermission(actor, permission)) return forbidden();
  // Benachrichtigungen, die diese Anfrage erzeugt, gehen nach der Antwort als Push hinaus, Webhooks ebenso.
  schedulePush();
  scheduleWebhooks();
  return { actor: actor as ApiContext["actor"], sql: carecoreDb() };
}

export function apiErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  recordServerError(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

const UUID = /^[0-9a-f-]{36}$/i;

export function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError(`${label} ist ungültig.`);
  return value;
}

export async function assertResident({ sql, actor }: ApiContext, residentId: unknown) {
  // Meldungen mit der Bezeichnung der Einrichtung; gelesen nur im Fehlerfall.
  const one = async () =>
    termsFor(
      (
        (await sql`SELECT settings->'terminology' AS t FROM carecore_organizations WHERE id = ${actor.organizationId}`) as Row[]
      )[0]?.t,
    ).one;
  if (typeof residentId !== "string" || !UUID.test(residentId)) throw new ApiError(`${await one()} ist ungültig.`);
  const rows =
    await sql`SELECT id FROM carecore_residents WHERE id = ${residentId} AND organization_id = ${actor.organizationId} LIMIT 1`;
  if (!rows[0]) throw new ApiError(`${await one()} nicht gefunden.`, 404);
  return residentId;
}

// Eintrag im Änderungsprotokoll als nicht ausgeführte Abfrage für `ctx.sql.transaction([...])`, damit Änderung
// und Protokoll gemeinsam gelingen oder scheitern.
export function auditStatement(
  ctx: ApiContext,
  entityType: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  return ctx.sql`
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, before_data, after_data)
    VALUES (${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, ${entityType}, ${entityId}, ${action},
      ${before === null ? null : JSON.stringify(before)}::jsonb, ${after === null ? null : JSON.stringify(after)}::jsonb)
  `;
}

export const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
export const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);
export const num = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number(value));
