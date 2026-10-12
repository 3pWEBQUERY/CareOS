import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  ApiError,
  assertUuid,
  auditStatement,
  iso,
  text,
  type ApiContext,
  type Row,
  type Sql,
} from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { API_KEYS_MAX, API_SCOPE_KEYS, type ApiKeySummary, type ApiScope } from "@/lib/api-keys-shared";

// Schlüssel für die öffentliche Schnittstelle. Nur die Administration erstellt und widerruft sie; gespeichert wird
// ausschliesslich der Hash, der Schlüssel erscheint einmal beim Erstellen.

const KEY_PREFIX = "cck_";
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

function requireAdmin(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Schnittstellen verwaltet die Administration.", 403);
}

const summary = (row: Row): ApiKeySummary => ({
  id: String(row.id),
  name: String(row.name),
  prefix: String(row.key_prefix),
  scopes: (row.scopes as string[]).filter((scope): scope is ApiScope => API_SCOPE_KEYS.includes(scope as ApiScope)),
  createdAt: iso(row.created_at) ?? "",
  createdBy: row.created_by_name ? String(row.created_by_name) : null,
  lastUsedAt: iso(row.last_used_at),
  revokedAt: iso(row.revoked_at),
});

export async function listApiKeys(ctx: ApiContext): Promise<ApiKeySummary[]> {
  requireAdmin(ctx);
  const rows = (await ctx.sql`
    SELECT k.*, u.display_name AS created_by_name FROM carecore_api_keys k
    LEFT JOIN carecore_users u ON u.id = k.created_by
    WHERE k.organization_id = ${ctx.actor.organizationId}
    ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC`) as Row[];
  return rows.map(summary);
}

export async function createApiKey(ctx: ApiContext, body: { name?: unknown; scopes?: unknown }) {
  requireAdmin(ctx);
  const name = text(body.name, 80);
  if (!name) throw new ApiError("Bitte einen Namen für den Schlüssel angeben.");
  const scopes = Array.isArray(body.scopes)
    ? API_SCOPE_KEYS.filter((scope) => (body.scopes as unknown[]).includes(scope))
    : [];
  if (!scopes.length) throw new ApiError("Bitte mindestens eine Berechtigung wählen.");
  const active = (await ctx.sql`
    SELECT COUNT(*)::int AS n FROM carecore_api_keys
    WHERE organization_id = ${ctx.actor.organizationId} AND revoked_at IS NULL`) as Row[];
  if (Number(active[0]?.n) >= API_KEYS_MAX)
    throw new ApiError(`Höchstens ${API_KEYS_MAX} aktive Schlüssel. Bitte zuerst einen widerrufen.`);
  const id = randomUUID();
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const prefix = key.slice(0, 12);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_api_keys (id, organization_id, name, key_prefix, key_hash, scopes, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${name}, ${prefix}, ${hashKey(key)}, ${scopes}, ${ctx.actor.id})`,
    auditStatement(ctx, "api_key", id, "api_key_created", null, { name, prefix, scopes }),
  ]);
  return { id, key, prefix };
}

export async function revokeApiKey(ctx: ApiContext, keyId: unknown) {
  requireAdmin(ctx);
  const id = assertUuid(keyId, "Schlüssel");
  const rows = (await ctx.sql`
    SELECT name, key_prefix, revoked_at FROM carecore_api_keys
    WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Schlüssel nicht gefunden.", 404);
  if (rows[0].revoked_at) return;
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_api_keys SET revoked_at = NOW() WHERE id = ${id} AND revoked_at IS NULL`,
    auditStatement(ctx, "api_key", id, "api_key_revoked", { name: rows[0].name, prefix: rows[0].key_prefix }, null),
  ]);
}

export type ApiClient = { keyId: string; organizationId: string; scopes: ApiScope[] };

// Prüft `Authorization: Bearer cck_…`. Ergebnis: der Schlüssel, oder Status und Meldung für die Antwort.
export async function authenticateApiKey(
  sql: Sql,
  authorization: string | null,
  scope: ApiScope,
): Promise<ApiClient | { status: 401 | 403; message: string }> {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  if (!match || !match[1].startsWith(KEY_PREFIX))
    return { status: 401, message: "Schlüssel fehlt (Authorization: Bearer …)." };
  const rows = (await sql`
    SELECT id, organization_id, scopes FROM carecore_api_keys
    WHERE key_hash = ${hashKey(match[1])} AND revoked_at IS NULL`) as Row[];
  if (!rows[0]) return { status: 401, message: "Schlüssel ist ungültig oder widerrufen." };
  const scopes = rows[0].scopes as ApiScope[];
  if (!scopes.includes(scope)) return { status: 403, message: `Der Schlüssel hat keine Berechtigung ${scope}.` };
  await sql`
    UPDATE carecore_api_keys SET last_used_at = NOW()
    WHERE id = ${rows[0].id} AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '1 minute')`;
  return { keyId: String(rows[0].id), organizationId: String(rows[0].organization_id), scopes };
}

// Jeder Zugriff über die Schnittstelle landet im Änderungsprotokoll (ohne Person, mit Schlüssel und Abfrage).
export async function logApiAccess(sql: Sql, client: ApiClient, resource: string, query: string, count: number) {
  await sql`
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, entity_type, entity_id, action, before_data, after_data)
    VALUES (${randomUUID()}, ${client.organizationId}, NULL, 'api_key', ${client.keyId}, 'api_read', NULL,
      ${JSON.stringify({ resource, query: query.slice(0, 500), count })}::jsonb)`;
}
