import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { ApiError } from "@/lib/api-context";
import { dispatchPush, type PushMessage } from "@/lib/push";
import { carecoreDb } from "@/lib/server-data";
import { endAllPush, exportMyData, readPreferences, resetPreferences, savePreferences } from "@/lib/user-settings";
import { DEFAULT_PREFERENCES } from "@/lib/user-settings-shared";
import { apiContextFor, fixture, q, qualify } from "../support/db";

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = "mailto:test@example.org";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

test("Persönliche Einstellungen: speichern, ungültige Werte ablehnen, zurücksetzen", async () => {
  const f = await fixture();
  const { actor } = await apiContextFor(f, "anna");
  const saved = await savePreferences(actor, {
    textSize: "xlarge",
    motion: "reduced",
    shortcuts: false,
    sound: true,
    startPage: "wounds",
    autoLogout: 30,
    quietHours: { enabled: true, from: "22:00", to: "06:00" },
    notify: { supply: false },
  });
  assert.equal(saved.textSize, "xlarge");
  const stored = await readPreferences(actor.id);
  assert.deepEqual(stored, saved);
  assert.equal(stored.notify.supply, false);
  assert.equal(stored.notify.tasks, true);
  // Nur mitgeschickte Felder ändern sich.
  const partial = await savePreferences(actor, { contrast: "high" });
  assert.equal(partial.motion, "reduced");
  assert.equal(partial.contrast, "high");
  const pinned = await savePreferences(actor, { insightPins: ["care:Dokumentation", "workforce:Besetzung"] });
  assert.deepEqual(pinned.insightPins, ["care:Dokumentation", "workforce:Besetzung"]);
  assert.equal(pinned.contrast, "high");

  for (const body of [
    { textSize: "riesig" },
    { autoLogout: 7 },
    { startPage: "/c/admin" },
    { quietHours: { enabled: true, from: "23:00", to: "23:00" } },
    { quietHours: { from: "7 Uhr" } },
    { shortcuts: "ja" },
    { insightPins: "care:Dokumentation" },
    { insightPins: ["fremd:Dokumentation"] },
    { insightPins: Array.from({ length: 17 }, (_, index) => `care:Kennzahl ${index}`) },
  ])
    assert.equal(await status(savePreferences(actor, body)), 400, JSON.stringify(body));
  assert.deepEqual(await readPreferences(actor.id), pinned, "abgelehnte Änderungen speichern nichts");

  assert.deepEqual(await resetPreferences(actor), DEFAULT_PREFERENCES);
  assert.deepEqual(await readPreferences(actor.id), DEFAULT_PREFERENCES);
});

test("Meine Daten: Export nur der eigenen Daten, ohne Passwort; Push auf allen Geräten beenden", async () => {
  const f = await fixture();
  await qualify(f, "max", "FAGE");
  const { actor } = await apiContextFor(f, "max");
  const session = randomUUID();
  await q(
    `INSERT INTO carecore_sessions (id, token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', 'Mozilla/5.0 (iPhone) Safari/604.1')`,
    [session, randomUUID().replace(/-/g, "").padEnd(64, "0"), f.people.max],
  );
  await q(
    `INSERT INTO carecore_push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, 'k', 'a')`,
    [randomUUID(), f.people.max, session, `https://push.example.org/${randomUUID()}`],
  );
  await q(
    `INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, entity_type, entity_id, action) VALUES ($1, $2, $3, 'task', $4, 'completed')`,
    [randomUUID(), f.org, f.people.max, randomUUID()],
  );
  await q(
    `INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, entity_type, entity_id, action) VALUES ($1, $2, $3, 'task', $4, 'created')`,
    [randomUUID(), f.org, f.people.anna, randomUUID()],
  );
  const data = await exportMyData(actor);
  const text = JSON.stringify(data);
  assert.ok(!/password_hash|token_hash|endpoint|p256dh/.test(text), "keine Geheimnisse im Export");
  assert.equal(data.profile.username.length > 0, true);
  assert.deepEqual(
    data.qualifications.map((row) => row.name),
    ["Fachperson Gesundheit"],
  );
  assert.equal(data.sessions[0].device, "Safari · iPhone");
  assert.equal(data.pushSubscriptions.length, 1);
  assert.deepEqual(
    data.activity.map((row) => row.action),
    ["completed"],
  );
  assert.equal(await endAllPush(actor), 1);
  assert.equal((await exportMyData(actor)).pushSubscriptions.length, 0);
});

test("Ruhezeit: in der Ruhezeit nur kritische Push-Nachrichten", async () => {
  const f = await fixture();
  const sql = carecoreDb();
  const sent: PushMessage[] = [];
  const send = async (_target: unknown, message: PushMessage) => {
    sent.push(message);
    return 201;
  };
  await dispatchPush(sql, send);
  sent.length = 0;
  const { actor } = await apiContextFor(f, "lea");
  const session = randomUUID();
  await q(
    `INSERT INTO carecore_sessions (id, token_hash, user_id, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')`,
    [session, randomUUID().replace(/-/g, "").padEnd(64, "1"), f.people.lea],
  );
  await q(
    `INSERT INTO carecore_push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at) VALUES ($1, $2, $3, $4, 'k', 'a', NOW() - INTERVAL '1 hour')`,
    [randomUUID(), f.people.lea, session, `https://push.example.org/${randomUUID()}`],
  );
  // Ruhezeit, die die aktuelle Uhrzeit der Einrichtung sicher enthält (jetzt − 1 h bis jetzt + 1 h).
  const [now] = await q<{ from: string; to: string }>(
    `SELECT to_char((NOW() - INTERVAL '1 hour') AT TIME ZONE 'Europe/Zurich', 'HH24:MI') AS from,
            to_char((NOW() + INTERVAL '1 hour') AT TIME ZONE 'Europe/Zurich', 'HH24:MI') AS to`,
  );
  await savePreferences(actor, { quietHours: { enabled: true, from: now.from, to: now.to } });
  const notify = (title: string, priority: string) =>
    q(
      `INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url) VALUES ($1, $2, $3, '', 'task_due', $4, '/c')`,
      [randomUUID(), f.people.lea, title, priority],
    );
  await notify("Aufgabe fällig", "normal");
  await notify("Sturz mit Verletzung", "critical");
  await dispatchPush(sql, send);
  assert.deepEqual(
    sent.map((message) => message.title),
    ["Sturz mit Verletzung"],
  );

  // Wer auch kritische Hinweise in der Ruhezeit nicht als Push will, sieht sie nur in der App.
  await savePreferences(actor, { quietHours: { critical: false } });
  await notify("Zweiter Sturz", "critical");
  await dispatchPush(sql, send);
  assert.deepEqual(
    sent.map((message) => message.title),
    ["Sturz mit Verletzung"],
  );

  await savePreferences(actor, { quietHours: { enabled: false } });
  await notify("Neue Aufgabe", "normal");
  await dispatchPush(sql, send);
  assert.deepEqual(
    sent.map((message) => message.title),
    ["Sturz mit Verletzung", "Neue Aufgabe"],
  );
});
