import { randomUUID } from "node:crypto";
import { after } from "next/server";
import webpush from "web-push";
import { ApiError, type ApiContext, type Row, type Sql } from "@/lib/api-context";
import { hashSessionToken } from "@/lib/auth";
import { carecoreDb } from "@/lib/server-data";
import { inQuietHours, notifyCategory, resolvePreferences } from "@/lib/user-settings-shared";

// Push-Benachrichtigungen (Web Push) für die installierte App.
// - Schlüssel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY und VAPID_SUBJECT (mailto: oder https:). Fehlt einer, ist Push aus.
// - Ein Abonnement gehört zu einer Anmeldung (carecore_sessions); Abmelden beendet auch die Push-Nachrichten.
// - Gepusht wird jede Benachrichtigung höchstens einmal (pushed_at), nur solange sie frisch ist, und nur, wenn die
//   Person diese Kategorie in ihren Einstellungen nicht ausgeschaltet hat (kritische immer).
// - In der persönlichen Ruhezeit (Ortszeit der Einrichtung) werden nur kritische Hinweise gepusht.
// - Auf dem Sperrbildschirm erscheint nur der Titel, nicht der Text der Benachrichtigung.

export type PushKeys = { publicKey: string; privateKey: string; subject: string };
export type PushMessage = { title: string; url: string; tag: string };
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
// Versand einer Nachricht; liefert den HTTP-Status des Push-Dienstes (404/410: Abonnement ist erloschen).
export type PushSender = (target: PushTarget, message: PushMessage) => Promise<number>;

const FRESH_MINUTES = 60;

export function pushKeys(): PushKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export function webPushSender(keys: PushKeys): PushSender {
  return async (target, message) => {
    try {
      const result = await webpush.sendNotification(target, JSON.stringify(message), {
        vapidDetails: keys,
        TTL: FRESH_MINUTES * 60,
        urgency: "normal",
      });
      return result.statusCode;
    } catch (error) {
      if (error instanceof webpush.WebPushError) return error.statusCode;
      throw error;
    }
  };
}

const base64Url = /^[A-Za-z0-9_-]+={0,2}$/;

// Abonnement dieses Geräts für die aktuelle Anmeldung speichern (ein anderes Konto auf demselben Gerät übernimmt es).
export async function savePushSubscription(ctx: ApiContext, sessionToken: string | undefined, input: unknown) {
  if (!pushKeys()) throw new ApiError("Push-Benachrichtigungen sind auf diesem Server nicht eingerichtet.", 503);
  const body = (input ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 2000)
    throw new ApiError("Das Push-Abonnement ist ungültig.");
  if (!base64Url.test(p256dh) || !base64Url.test(auth) || p256dh.length > 200 || auth.length > 100)
    throw new ApiError("Das Push-Abonnement ist ungültig.");
  const session = await currentSession(ctx, sessionToken);
  await ctx.sql`
    INSERT INTO carecore_push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth)
    VALUES (${randomUUID()}, ${ctx.actor.id}, ${session}, ${endpoint}, ${p256dh}, ${auth})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id,
      p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = NOW(), last_sent_at = NULL`;
}

export async function deletePushSubscription(ctx: ApiContext, endpoint: unknown) {
  if (typeof endpoint !== "string") throw new ApiError("Das Push-Abonnement ist ungültig.");
  await ctx.sql`DELETE FROM carecore_push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${ctx.actor.id}`;
}

// Ist dieses Gerät (endpoint) für die aktuelle Anmeldung abonniert?
export async function isPushSubscribed(ctx: ApiContext, sessionToken: string | undefined, endpoint: string) {
  const session = await currentSession(ctx, sessionToken);
  const rows = await ctx.sql`
    SELECT 1 FROM carecore_push_subscriptions
    WHERE endpoint = ${endpoint} AND user_id = ${ctx.actor.id} AND session_id = ${session}`;
  return rows.length > 0;
}

async function currentSession(ctx: ApiContext, sessionToken: string | undefined) {
  const rows = sessionToken
    ? await ctx.sql`SELECT id FROM carecore_sessions WHERE token_hash = ${hashSessionToken(sessionToken)} AND user_id = ${ctx.actor.id} AND expires_at > NOW()`
    : [];
  if (!rows[0]) throw new ApiError("Nicht angemeldet.", 401);
  return String(rows[0].id);
}

// Versendet alle noch nicht gepushten Benachrichtigungen. Jede Benachrichtigung wird zuerst als versandt
// markiert (so schickt ein paralleler Lauf sie nicht ein zweites Mal), ältere als FRESH_MINUTES werden nur markiert.
export async function dispatchPush(sql: Sql, send: PushSender) {
  const claimed = (await sql`
    UPDATE carecore_notifications SET pushed_at = NOW()
    WHERE pushed_at IS NULL
    RETURNING id, user_id, title, type, priority, link_url, created_at,
      created_at > NOW() - make_interval(mins => ${FRESH_MINUTES}) AS fresh`) as Row[];
  const fresh = claimed.filter((row) => row.fresh);
  if (!fresh.length) return { sent: 0, removed: 0 };
  const userIds = [...new Set(fresh.map((row) => String(row.user_id)))];
  const [subscriptions, profiles] = await Promise.all([
    sql`
      SELECT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth, ps.created_at
      FROM carecore_push_subscriptions ps
      JOIN carecore_sessions s ON s.id = ps.session_id AND s.expires_at > NOW()
      JOIN carecore_users u ON u.id = ps.user_id AND u.active
      WHERE ps.user_id = ANY(${userIds}::uuid[])`,
    sql`
      SELECT p.user_id, p.preferences,
        to_char(NOW() AT TIME ZONE COALESCE(o.timezone, 'Europe/Zurich'), 'HH24:MI') AS local_time
      FROM carecore_user_profiles p LEFT JOIN carecore_organizations o ON o.id = p.organization_id
      WHERE p.user_id = ANY(${userIds}::uuid[])`,
  ]);
  const preferences = new Map(profiles.map((row) => [String(row.user_id), resolvePreferences(row.preferences)]));
  const localTime = new Map(profiles.map((row) => [String(row.user_id), String(row.local_time)]));
  let sent = 0;
  const expired = new Set<string>();
  const delivered = new Set<string>();
  for (const notification of fresh) {
    const userId = String(notification.user_id);
    const category = notifyCategory(String(notification.type));
    const critical = notification.priority === "critical";
    const personal = preferences.get(userId);
    const wanted = critical || !category || personal?.notify[category] !== false;
    // In der persönlichen Ruhezeit nur kritische Hinweise; die übrigen bleiben in der App sichtbar.
    const quiet =
      !!personal &&
      (!critical || !personal.quietHours.critical) &&
      inQuietHours(personal.quietHours, localTime.get(userId) ?? "");
    if (!wanted || quiet) continue;
    const message: PushMessage = {
      title: String(notification.title),
      url:
        typeof notification.link_url === "string" && notification.link_url.startsWith("/")
          ? notification.link_url
          : "/",
      tag: String(notification.id),
    };
    for (const subscription of subscriptions) {
      if (String(subscription.user_id) !== userId || expired.has(String(subscription.id))) continue;
      // Nur Benachrichtigungen, die nach dem Abonnieren entstanden sind.
      if (new Date(String(subscription.created_at)) > new Date(String(notification.created_at))) continue;
      const target = {
        endpoint: String(subscription.endpoint),
        keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth) },
      };
      const status = await send(target, message).catch((error: unknown) => {
        console.error("Push failed", error);
        return 0;
      });
      if (status === 404 || status === 410) expired.add(String(subscription.id));
      else if (status >= 200 && status < 300) {
        sent += 1;
        delivered.add(String(subscription.id));
      }
    }
  }
  if (expired.size) await sql`DELETE FROM carecore_push_subscriptions WHERE id = ANY(${[...expired]}::uuid[])`;
  if (delivered.size)
    await sql`UPDATE carecore_push_subscriptions SET last_sent_at = NOW() WHERE id = ANY(${[...delivered]}::uuid[])`;
  return { sent, removed: expired.size };
}

// Nach der Antwort versenden, damit die Anfrage nicht wartet. Ohne Schlüssel geschieht nichts.
export function schedulePush() {
  const keys = pushKeys();
  if (!keys) return;
  after(() => dispatchPush(carecoreDb(), webPushSender(keys)).catch((error) => console.error("Push failed", error)));
}
