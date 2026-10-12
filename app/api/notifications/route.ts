import { NextResponse } from "next/server";
import { carecoreActor, carecoreDb } from "@/lib/server-data";
import { createLearningReminders } from "@/lib/learning";
import { createBtmReminders } from "@/lib/medication-btm";
import { createDeviceReminders } from "@/lib/devices";
import { createFeedbackReminders } from "@/lib/feedback";
import { createFridgeReminders } from "@/lib/fridges";
import { createEffectCheckReminders } from "@/lib/medication-effect";
import { schedulePush } from "@/lib/push";
import { createRosterReminders } from "@/lib/roster/reminders";
import { createDueReminders } from "@/lib/tasks";
import { readPreferences } from "@/lib/user-settings";
import { createWoundReminders } from "@/lib/wounds";
import { notifyCategory } from "@/lib/user-settings-shared";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const sql = carecoreDb();
    if (actor.organizationId) {
      const ctx = { actor: { ...actor, organizationId: actor.organizationId }, sql };
      await Promise.all([
        createDueReminders(ctx),
        createRosterReminders(ctx),
        createLearningReminders(ctx),
        createBtmReminders(ctx),
        createWoundReminders(ctx),
        createEffectCheckReminders(ctx),
        createDeviceReminders(ctx),
        createFridgeReminders(ctx),
        createFeedbackReminders(ctx),
      ]).catch((error) => console.error("Reminders failed", error));
      schedulePush();
    }
    const [rows, preferences] = await Promise.all([
      sql`SELECT id, title, body, type, priority, link_url, read_at, created_at FROM carecore_notifications WHERE user_id = ${actor.id} ORDER BY created_at DESC LIMIT 100`,
      readPreferences(actor.id),
    ]);
    // Categories switched off in the personal settings are hidden; critical notices always show.
    const notifications = rows.filter((row) => {
      const category = notifyCategory(String(row.type));
      return row.priority === "critical" || !category || preferences.notify[category];
    });
    return NextResponse.json({ notifications });
  } catch (error) {
    console.error("Notifications GET failed", error);
    return NextResponse.json({ error: "Benachrichtigungen konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const body = (await request.json()) as { id?: unknown; ids?: unknown; all?: unknown };
    const UUID = /^[0-9a-f-]{36}$/i;
    // Mehrere auf einmal (Bündel im Posteingang).
    const ids =
      Array.isArray(body.ids) &&
      body.ids.length <= 200 &&
      body.ids.every((id) => typeof id === "string" && UUID.test(id))
        ? (body.ids as string[])
        : null;
    const sql = carecoreDb();
    if (body.all === true) {
      await sql`UPDATE carecore_notifications SET read_at = COALESCE(read_at, NOW()) WHERE user_id = ${actor.id}`;
    } else if (ids?.length) {
      await sql`UPDATE carecore_notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ANY(${ids}::uuid[]) AND user_id = ${actor.id}`;
    } else if (typeof body.id === "string" && UUID.test(body.id)) {
      await sql`UPDATE carecore_notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ${body.id} AND user_id = ${actor.id}`;
    } else return NextResponse.json({ error: "Ungültige Benachrichtigung." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Notifications PATCH failed", error);
    return NextResponse.json({ error: "Änderung konnte nicht gespeichert werden." }, { status: 500 });
  }
}
