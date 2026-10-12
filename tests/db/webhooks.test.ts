import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import {
  RETRY_MINUTES,
  createWebhook,
  deleteWebhook,
  dispatchWebhooks,
  listWebhooks,
  pingWebhook,
  signatureHeader,
  type WebhookSender,
} from "@/lib/webhooks";
import { apiContextFor, createResident, fixture, q } from "../support/db";

process.env.CARECORE_MFA_KEY = randomBytes(32).toString("hex");

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

async function adminOf(f: Awaited<ReturnType<typeof fixture>>) {
  const lead = await apiContextFor(f, "leadA");
  return { ...lead, actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] } };
}

type Sent = { url: string; body: string; headers: Record<string, string> };
const recorder = (status: number | Error) => {
  const sent: Sent[] = [];
  const send: WebhookSender = async (url, body, headers) => {
    sent.push({ url, body, headers });
    if (status instanceof Error) throw status;
    return status;
  };
  return { sent, send };
};

// Andere Tests können eigene Meldungen vormerken; hier zählen nur die dieses Webhooks.
const deliveriesOf = (webhookId: string) =>
  q<{ event: string; resource: string; patient: string | null; status: string; attempts: number; wait: number }>(
    `SELECT event, resource, patient, status, attempts,
       ROUND(EXTRACT(EPOCH FROM (next_attempt_at - NOW())) / 60)::int AS wait
     FROM carecore_webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at, event`,
    [webhookId],
  );

test("Webhooks: nur Administration, nur https und externe Ziele, Geheimnis verschlüsselt, protokolliert", async () => {
  const f = await fixture();
  const admin = await adminOf(f);
  const anna = await apiContextFor(f, "anna");
  const valid = { name: "Spital", url: "https://example.org/hook", events: ["Observation.created"] };

  assert.equal((await failure(createWebhook(anna, valid))).status, 403);
  assert.equal((await failure(createWebhook(admin, { ...valid, url: "http://example.org/hook" }))).status, 400);
  assert.equal((await failure(createWebhook(admin, { ...valid, url: "https://10.0.0.5/hook" }))).status, 400);
  assert.equal((await failure(createWebhook(admin, { ...valid, events: ["Alles"] }))).status, 400);

  const { id, secret } = await createWebhook(admin, valid);
  assert.match(secret, /^whsec_/);
  const stored = await q<{ secret_encrypted: string }>(`SELECT secret_encrypted FROM carecore_webhooks WHERE id = $1`, [
    id,
  ]);
  assert.equal(stored[0].secret_encrypted.includes(secret), false, "Geheimnis liegt nur verschlüsselt vor");
  const [listed] = await listWebhooks(admin);
  assert.deepEqual(
    [listed.name, listed.url, listed.events],
    ["Spital", "https://example.org/hook", ["Observation.created"]],
  );
  assert.equal(JSON.stringify(listed).includes("whsec_"), false);

  await deleteWebhook(admin, id);
  assert.equal((await listWebhooks(admin)).length, 0);
  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'webhook' AND entity_id = $1 ORDER BY created_at`,
    [id],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["webhook_created", "webhook_deleted"],
  );
});

test("Webhooks: Ereignisse per Trigger vorgemerkt, signiert zugestellt, Wiederholung mit Wartezeit", async () => {
  const f = await fixture();
  const other = await fixture();
  const admin = await adminOf(f);
  const hook = await createWebhook(admin, {
    name: "Spital",
    url: "https://example.org/hook",
    events: ["Observation.created", "Patient.created", "Patient.updated"],
  });
  const erna = await createResident(f, "Erna Muster");
  const foreign = await createResident(other, "Fritz Fremd");
  const measurement = randomUUID();
  await q(
    `INSERT INTO carecore_vital_measurements (id, resident_id, metric, value, unit) VALUES ($1, $2, 'Puls', 72, '/min')`,
    [measurement, erna],
  );
  await q(
    `INSERT INTO carecore_vital_measurements (id, resident_id, metric, value, unit) VALUES ($1, $2, 'Puls', 70, '/min')`,
    [randomUUID(), foreign],
  );
  await q(`UPDATE carecore_residents SET photo_mime_type = 'image/png' WHERE id = $1`, [erna]);
  await q(`UPDATE carecore_residents SET status = 'discharged' WHERE id = $1`, [erna]);

  const queued = await deliveriesOf(hook.id);
  assert.deepEqual(
    queued.map((row) => [row.event, row.resource, row.patient]),
    [
      ["Patient.created", `Patient/${erna}`, `Patient/${erna}`],
      ["Observation.created", `Observation/${measurement}`, `Patient/${erna}`],
      ["Patient.updated", `Patient/${erna}`, `Patient/${erna}`],
    ],
    "nur eigene Einrichtung; Foto ändert die FHIR-Ressource nicht",
  );

  // Erster Versuch scheitert (Antwort 500) → nach der ersten Wartezeit erneut.
  const failing = recorder(500);
  await dispatchWebhooks(admin.sql, failing.send);
  const mine = failing.sent.filter((item) => item.url === "https://example.org/hook");
  assert.ok(mine.length >= 3);
  const afterFailure = await deliveriesOf(hook.id);
  assert.ok(
    afterFailure.every((row) => row.status === "pending" && row.attempts === 1 && row.wait === RETRY_MINUTES[0]),
  );
  const [first] = await listWebhooks(admin);
  assert.equal(first.lastError, "Antwort 500");
  assert.equal(first.pending, 3);

  // Wieder fällig → zugestellt, Signatur prüfbar mit dem Geheimnis.
  await q(`UPDATE carecore_webhook_deliveries SET next_attempt_at = NOW() WHERE webhook_id = $1`, [hook.id]);
  const ok = recorder(204);
  await dispatchWebhooks(admin.sql, ok.send);
  const delivered = ok.sent.filter(
    (item) => item.headers["X-CareCore-Event"] === "Observation.created" && item.body.includes(measurement),
  );
  assert.equal(delivered.length, 1);
  const { body, headers } = delivered[0];
  assert.deepEqual(JSON.parse(body).resource, `Observation/${measurement}`);
  assert.deepEqual(
    Object.keys(JSON.parse(body)).sort(),
    ["id", "occurredAt", "patient", "resource", "type"],
    "die Meldung enthält nur den Verweis, keine Messwerte",
  );
  const timestamp = Number(/^t=(\d+),/.exec(headers["X-CareCore-Signature"])?.[1]);
  assert.equal(headers["X-CareCore-Signature"], signatureHeader(hook.secret, timestamp, body));
  assert.ok((await deliveriesOf(hook.id)).every((row) => row.status === "delivered"));
  assert.equal((await listWebhooks(admin))[0].pending, 0);
});

test("Webhooks: nach dem letzten Versuch gescheitert; Probemeldung; Entfernen verwirft Ausstehendes", async () => {
  const f = await fixture();
  const admin = await adminOf(f);
  const hook = await createWebhook(admin, {
    name: "Praxis",
    url: "https://example.net/in",
    events: ["Patient.updated"],
  });
  await pingWebhook(admin, hook.id);
  await q(`UPDATE carecore_webhook_deliveries SET attempts = $2 WHERE webhook_id = $1`, [
    hook.id,
    RETRY_MINUTES.length,
  ]);
  const down = recorder(new Error("connect ECONNREFUSED"));
  await dispatchWebhooks(admin.sql, down.send);
  const [ping] = await deliveriesOf(hook.id);
  assert.equal(ping.event, "ping");
  assert.equal(ping.status, "failed");
  assert.equal((await listWebhooks(admin))[0].failed, 1);

  await pingWebhook(admin, hook.id);
  await deleteWebhook(admin, hook.id);
  assert.equal((await deliveriesOf(hook.id)).length, 0);
});
