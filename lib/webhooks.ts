import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup, type LookupAddress, type LookupOptions } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { after } from "next/server";
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
import { decryptSecret, encryptSecret, mfaKey } from "@/lib/mfa-core";
import { hasPermission, carecoreDb } from "@/lib/server-data";
import { WEBHOOKS_MAX, WEBHOOK_EVENT_KEYS, type WebhookEvent, type WebhookSummary } from "@/lib/webhooks-shared";

// Webhooks: angebundene Systeme erhalten nach einer Änderung eine signierte Meldung mit dem Verweis auf die
// FHIR-Ressource; die Daten selbst liest das System mit seinem Schlüssel über die Schnittstelle. Vorgemerkt werden die
// Ereignisse per Trigger in der Datenbank (Migration 0046), zugestellt nach der Antwort einer beliebigen Anfrage, mit
// Wiederholungen. Ziele im internen Netz sind gesperrt (auch nach der Namensauflösung).

const SECRET_PREFIX = "whsec_";
const TIMEOUT_MS = 5000;
const BATCH = 20;
// Wartezeit vor dem 2., 3. … Versuch (Minuten); danach gilt die Zustellung als gescheitert.
export const RETRY_MINUTES = [1, 5, 30, 120, 720];

// ---------- Ziel-Adressen ----------

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96],
] as const)
  blocked.addSubnet(network, prefix, "ipv6");

// Private, lokale, reservierte Adressen (auch IPv4 in IPv6 verpackt) sind als Ziel nicht erlaubt.
export function isBlockedAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1], "ipv4");
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) return blocked.check(address, "ipv6");
  return true;
}

export function validateWebhookUrl(input: unknown) {
  const raw = text(input, 500);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError("Bitte eine vollständige Adresse angeben (https://…).");
  }
  if (url.protocol !== "https:") throw new ApiError("Webhooks gehen nur an https-Adressen.");
  if (url.username || url.password) throw new ApiError("Die Adresse darf keine Zugangsdaten enthalten.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local"))
    throw new ApiError("Adressen im internen Netz sind nicht erlaubt.");
  if (isIP(host) && isBlockedAddress(host)) throw new ApiError("Adressen im internen Netz sind nicht erlaubt.");
  url.hash = "";
  return url.toString();
}

// ---------- Signatur ----------

// `X-CareCore-Signature: t=<Unix-Zeit>,v1=<HMAC-SHA256 von "<t>.<Inhalt>">`
export function signatureHeader(secret: string, timestamp: number, body: string) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

// ---------- Verwaltung (Administration) ----------

function requireAdmin(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Webhooks verwaltet die Administration.", 403);
}

function requireKey() {
  const key = mfaKey();
  if (!key)
    throw new ApiError("Webhooks brauchen den Serverschlüssel CARECORE_MFA_KEY. Bitte beim Betrieb einrichten.", 503);
  return key;
}

export async function listWebhooks(ctx: ApiContext): Promise<WebhookSummary[]> {
  requireAdmin(ctx);
  const rows = (await ctx.sql`
    SELECT w.id, w.name, w.url, w.events, w.created_at, w.last_delivery_at, w.last_status, w.last_error,
      u.display_name AS created_by_name,
      (SELECT COUNT(*)::int FROM carecore_webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'pending') AS pending,
      (SELECT COUNT(*)::int FROM carecore_webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'failed') AS failed
    FROM carecore_webhooks w LEFT JOIN carecore_users u ON u.id = w.created_by
    WHERE w.organization_id = ${ctx.actor.organizationId}
    ORDER BY w.created_at DESC`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    url: String(row.url),
    events: (row.events as string[]).filter((event): event is WebhookEvent =>
      WEBHOOK_EVENT_KEYS.includes(event as WebhookEvent),
    ),
    createdAt: iso(row.created_at) ?? "",
    createdBy: row.created_by_name ? String(row.created_by_name) : null,
    lastDeliveryAt: iso(row.last_delivery_at),
    lastStatus: row.last_status === null || row.last_status === undefined ? null : Number(row.last_status),
    lastError: row.last_error ? String(row.last_error) : null,
    pending: Number(row.pending ?? 0),
    failed: Number(row.failed ?? 0),
  }));
}

export async function createWebhook(ctx: ApiContext, body: { name?: unknown; url?: unknown; events?: unknown }) {
  requireAdmin(ctx);
  const name = text(body.name, 80);
  if (!name) throw new ApiError("Bitte einen Namen angeben.");
  const url = validateWebhookUrl(body.url);
  const events = Array.isArray(body.events)
    ? WEBHOOK_EVENT_KEYS.filter((event) => (body.events as unknown[]).includes(event))
    : [];
  if (!events.length) throw new ApiError("Bitte mindestens ein Ereignis wählen.");
  const key = requireKey();
  const count = (await ctx.sql`
    SELECT COUNT(*)::int AS n FROM carecore_webhooks WHERE organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (Number(count[0]?.n) >= WEBHOOKS_MAX)
    throw new ApiError(`Höchstens ${WEBHOOKS_MAX} Webhooks. Bitte zuerst einen entfernen.`);
  const id = randomUUID();
  const secret = `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_webhooks (id, organization_id, name, url, secret_encrypted, events, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${name}, ${url}, ${encryptSecret(secret, key)}, ${events}, ${ctx.actor.id})`,
    auditStatement(ctx, "webhook", id, "webhook_created", null, { name, url, events }),
  ]);
  return { id, secret };
}

async function ownWebhook(ctx: ApiContext, webhookId: unknown) {
  const id = assertUuid(webhookId, "Webhook");
  const rows = (await ctx.sql`
    SELECT name, url, events FROM carecore_webhooks WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Webhook nicht gefunden.", 404);
  return { id, row: rows[0] };
}

export async function deleteWebhook(ctx: ApiContext, webhookId: unknown) {
  requireAdmin(ctx);
  const { id, row } = await ownWebhook(ctx, webhookId);
  await ctx.sql.transaction([
    ctx.sql`DELETE FROM carecore_webhooks WHERE id = ${id}`,
    auditStatement(ctx, "webhook", id, "webhook_deleted", { name: row.name, url: row.url, events: row.events }, null),
  ]);
}

// Probemeldung („ping“), um die Anbindung zu prüfen; zugestellt wie jede andere Meldung.
export async function pingWebhook(ctx: ApiContext, webhookId: unknown) {
  requireAdmin(ctx);
  requireKey();
  const { id } = await ownWebhook(ctx, webhookId);
  await ctx.sql`
    INSERT INTO carecore_webhook_deliveries (webhook_id, event, resource) VALUES (${id}, 'ping', ${`Organization/${ctx.actor.organizationId}`})`;
}

// ---------- Zustellung ----------

export type WebhookSender = (url: string, body: string, headers: Record<string, string>) => Promise<number>;

// Namensauflösung mit Sperre: auch ein Name, der auf eine interne Adresse zeigt, wird nicht angesprochen.
function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address)))
      return callback(Object.assign(new Error("Ziel liegt im internen Netz."), { code: "EBLOCKED" }), "");
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

export const httpsSender: WebhookSender = (url, body, headers) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const host = target.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isBlockedAddress(host)) return reject(new Error("Ziel liegt im internen Netz."));
    const req = request(
      target,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung")));
    req.on("error", reject);
    req.end(body);
  });

// Fällige Meldungen übernehmen (andere Läufe überspringen sie) und zustellen. Erfolg = Antwort 2xx.
export async function dispatchWebhooks(sql: Sql, send: WebhookSender = httpsSender, now = () => new Date()) {
  const key = mfaKey();
  if (!key) return 0;
  const due = (await sql`
    UPDATE carecore_webhook_deliveries d SET next_attempt_at = NOW() + INTERVAL '2 minutes'
    FROM carecore_webhooks w
    WHERE w.id = d.webhook_id AND d.id IN (
      SELECT id FROM carecore_webhook_deliveries
      WHERE status = 'pending' AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
    RETURNING d.id, d.webhook_id, d.event, d.resource, d.patient, d.occurred_at, d.attempts, w.url, w.secret_encrypted`) as Row[];
  for (const row of due) {
    const attempts = Number(row.attempts) + 1;
    const body = JSON.stringify({
      id: String(row.id),
      type: String(row.event),
      occurredAt: iso(row.occurred_at),
      resource: String(row.resource),
      ...(row.patient ? { patient: String(row.patient) } : {}),
    });
    let status: number | null = null;
    let error: string | null = null;
    try {
      const secret = decryptSecret(String(row.secret_encrypted), key);
      const timestamp = Math.floor(now().getTime() / 1000);
      status = await send(String(row.url), body, {
        "Content-Type": "application/json",
        "User-Agent": "CareCore-Webhooks/1",
        "X-CareCore-Event": String(row.event),
        "X-CareCore-Delivery": String(row.id),
        "X-CareCore-Signature": signatureHeader(secret, timestamp, body),
      });
      if (status < 200 || status >= 300) error = `Antwort ${status}`;
    } catch (cause) {
      error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 300);
    }
    const delivered = error === null;
    const giveUp = !delivered && attempts > RETRY_MINUTES.length;
    const wait = RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1];
    await sql.transaction([
      sql`
        UPDATE carecore_webhook_deliveries SET attempts = ${attempts}, last_status = ${status}, last_error = ${error},
          status = ${delivered ? "delivered" : giveUp ? "failed" : "pending"},
          delivered_at = ${delivered ? now().toISOString() : null},
          next_attempt_at = NOW() + make_interval(mins => ${delivered || giveUp ? 0 : wait})
        WHERE id = ${row.id}`,
      sql`
        UPDATE carecore_webhooks SET last_delivery_at = NOW(), last_status = ${status}, last_error = ${error}
        WHERE id = ${row.webhook_id}`,
    ]);
  }
  // Erledigte Zustellungen nach 30 Tagen aufräumen.
  if (due.length)
    await sql`
      DELETE FROM carecore_webhook_deliveries
      WHERE status IN ('delivered', 'failed') AND created_at < NOW() - INTERVAL '30 days'`;
  return due.length;
}

// Nach der Antwort zustellen; ohne Serverschlüssel gibt es keine Webhooks.
export function scheduleWebhooks() {
  if (!mfaKey()) return;
  after(() => dispatchWebhooks(carecoreDb()).catch((error) => console.error("Webhooks failed", error)));
}
