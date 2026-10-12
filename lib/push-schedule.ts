import { ApiError, type ApiContext, type Sql } from "@/lib/api-context";
import { createLearningReminders } from "@/lib/learning";
import { createBtmReminders } from "@/lib/medication-btm";
import { createDeviceReminders } from "@/lib/devices";
import { createFeedbackReminders } from "@/lib/feedback";
import { createFridgeReminders } from "@/lib/fridges";
import { createEffectCheckReminders } from "@/lib/medication-effect";
import { dispatchPush, pushKeys, webPushSender, type PushSender } from "@/lib/push";
import { createRosterReminders } from "@/lib/roster/reminders";
import { createDueReminders } from "@/lib/tasks";
import { createWoundReminders } from "@/lib/wounds";

// Zeitgesteuerter Lauf (Cron): Erinnerungen (fällige Aufgaben, BtM-Kontrollen, Wundversorgung, Wirkungskontrollen, Dienstplan,
// Schulungen) für alle
// Personen mit Push-Abonnement erzeugen, auch wenn die App gerade geschlossen ist, und danach versenden.
export async function runPushSchedule(sql: Sql, send?: PushSender) {
  const keys = pushKeys();
  const sender = send ?? (keys ? webPushSender(keys) : null);
  if (!sender) throw new ApiError("Push-Benachrichtigungen sind auf diesem Server nicht eingerichtet.", 503);
  const people = await sql`
    SELECT DISTINCT u.id, u.username, u.display_name, u.role, p.organization_id,
      carecore_effective_permissions(u.id) AS permissions
    FROM carecore_push_subscriptions ps
    JOIN carecore_sessions s ON s.id = ps.session_id AND s.expires_at > NOW()
    JOIN carecore_users u ON u.id = ps.user_id AND u.active
    JOIN carecore_user_profiles p ON p.user_id = u.id AND p.organization_id IS NOT NULL`;
  for (const person of people) {
    const ctx: ApiContext = {
      sql,
      actor: {
        id: String(person.id),
        username: String(person.username),
        display_name: String(person.display_name),
        role: String(person.role),
        organizationId: String(person.organization_id),
        permissions: Array.isArray(person.permissions) ? (person.permissions as string[]) : [],
      },
    };
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
  }
  return dispatchPush(sql, sender);
}
