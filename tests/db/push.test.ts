import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { ApiError } from "@/lib/api-context";
import { hashSessionToken } from "@/lib/auth";
import { dispatchPush, isPushSubscribed, savePushSubscription, type PushMessage, type PushTarget } from "@/lib/push";
import { runPushSchedule } from "@/lib/push-schedule";
import { carecoreDb } from "@/lib/server-data";
import { apiContextFor, fixture, q, type Fixture } from "../support/db";

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = "mailto:test@example.org";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

// Angemeldete Sitzung und ein Push-Abonnement dafür.
async function subscribe(f: Fixture, person: string) {
  const token = randomUUID();
  const session = randomUUID();
  await q(
    `INSERT INTO carecore_sessions (id, token_hash, user_id, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')`,
    [session, hashSessionToken(token), f.people[person]],
  );
  const endpoint = `https://push.example.org/${randomUUID()}`;
  const ctx = await apiContextFor(f, person);
  await savePushSubscription(ctx, token, {
    endpoint,
    keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "tBHItJI5svbpez7KI4CCXg" },
  });
  return { ctx, token, session, endpoint };
}

function recorder(status = 201) {
  const sent: Array<{ endpoint: string; message: PushMessage }> = [];
  const send = async (target: PushTarget, message: PushMessage) => {
    sent.push({ endpoint: target.endpoint, message });
    return status;
  };
  return { sent, send };
}

async function notification(
  userId: string,
  type: string,
  title: string,
  extra: { priority?: string; age?: string } = {},
) {
  await q(
    `INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, created_at)
     VALUES ($1, $2, $3, 'Text mit Details', $4, $5, '/c/betrieb/aufgaben', NOW() - $6::interval)`,
    [randomUUID(), userId, title, type, extra.priority ?? "normal", extra.age ?? "0 seconds"],
  );
}

test("Push: Abonnement je Anmeldung, jede Benachrichtigung höchstens einmal, nur der Titel", async () => {
  const f = await fixture();
  const sql = carecoreDb();
  await dispatchPush(sql, recorder().send);
  const anna = await subscribe(f, "anna");
  assert.equal(await isPushSubscribed(anna.ctx, anna.token, anna.endpoint), true);
  assert.equal(
    (await failure(savePushSubscription(anna.ctx, anna.token, { endpoint: "http://unsicher" }))).status,
    400,
  );
  assert.equal((await failure(savePushSubscription(anna.ctx, undefined, { endpoint: anna.endpoint }))).status, 400);

  await notification(f.people.anna, "task_due", "Aufgabe fällig: Verband wechseln");
  await notification(f.people.anna, "task_due", "Alte Aufgabe", { age: "2 hours" });
  await notification(f.people.max, "task_due", "Für Max ohne Abonnement");
  const first = recorder();
  assert.deepEqual(await dispatchPush(sql, first.send), { sent: 1, removed: 0 });
  assert.deepEqual(first.sent[0].endpoint, anna.endpoint);
  assert.equal(first.sent[0].message.title, "Aufgabe fällig: Verband wechseln");
  assert.equal(first.sent[0].message.url, "/c/betrieb/aufgaben");
  assert.ok(!JSON.stringify(first.sent[0].message).includes("Details"), "der Text geht nicht an den Push-Dienst");
  const again = recorder();
  await dispatchPush(sql, again.send);
  assert.equal(again.sent.length, 0, "nichts wird zweimal gepusht");
  const [pending] = await q<{ count: string }>(
    `SELECT COUNT(*) AS count FROM carecore_notifications WHERE user_id = ANY($1::uuid[]) AND pushed_at IS NULL`,
    [Object.values(f.people)],
  );
  assert.equal(Number(pending.count), 0);

  // Ausgeschaltete Kategorie: kein Push, kritische trotzdem.
  await q(`UPDATE carecore_user_profiles SET preferences = '{"notify":{"tasks":false}}'::jsonb WHERE user_id = $1`, [
    f.people.anna,
  ]);
  await notification(f.people.anna, "task_due", "Leise Aufgabe");
  await notification(f.people.anna, "task_due", "Kritische Aufgabe", { priority: "critical" });
  const filtered = recorder();
  await dispatchPush(sql, filtered.send);
  assert.deepEqual(
    filtered.sent.map((item) => item.message.title),
    ["Kritische Aufgabe"],
  );

  // Abmelden beendet das Abonnement.
  await q(`DELETE FROM carecore_sessions WHERE id = $1`, [anna.session]);
  const [left] = await q<{ count: string }>(
    `SELECT COUNT(*) AS count FROM carecore_push_subscriptions WHERE endpoint = $1`,
    [anna.endpoint],
  );
  assert.equal(Number(left.count), 0);
});

test("Push: erloschene Abonnements werden entfernt; Zeitplan erzeugt fällige Erinnerungen", async () => {
  const f = await fixture();
  const sql = carecoreDb();
  await dispatchPush(sql, recorder().send);
  const lea = await subscribe(f, "lea");
  await notification(f.people.lea, "team_news", "Neuigkeit");
  const gone = recorder(410);
  assert.deepEqual(await dispatchPush(sql, gone.send), { sent: 0, removed: 1 });
  assert.equal(await isPushSubscribed(lea.ctx, lea.token, lea.endpoint), false);

  // Fällige Aufgabe mit Erinnerung: der Zeitplan legt die Benachrichtigung an und pusht sie, ohne dass die App offen ist.
  const max = await subscribe(f, "max");
  await q(
    `INSERT INTO carecore_tasks (id, organization_id, assigned_to, created_by, title, due_at, remind)
     VALUES ($1, $2, $3, $3, 'Blutzucker messen', NOW() + INTERVAL '5 minutes', TRUE)`,
    [randomUUID(), f.org, f.people.max],
  );
  const scheduled = recorder();
  await runPushSchedule(sql, scheduled.send);
  const mine = scheduled.sent.filter((item) => item.endpoint === max.endpoint);
  assert.deepEqual(
    mine.map((item) => item.message.title),
    ["Aufgabe fällig: Blutzucker messen"],
  );
  const rerun = recorder();
  await runPushSchedule(sql, rerun.send);
  assert.equal(rerun.sent.filter((item) => item.endpoint === max.endpoint).length, 0);
});
