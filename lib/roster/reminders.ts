import "server-only";
import type { ApiContext } from "@/lib/api-context";
import { rosterContextFrom } from "./context";
import { expireStaleSwaps } from "./swap-service";
import { checkMissingClockOuts } from "./time-service";

// Beim Laden der Benachrichtigungen: Erinnerung an veröffentlichte Dienste der nächsten 24 Stunden
// (einmal pro Dienst), fehlende Clock-outs markieren und abgelaufene Tauschanfragen schliessen.
export async function createRosterReminders(ctx: ApiContext) {
  await ctx.sql`
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    SELECT gen_random_uuid(), s.employee_id, 'Dienst morgen: ' || st.name,
      'Beginn ' || to_char(s.planned_start AT TIME ZONE o.timezone, 'DD.MM. HH24:MI') || ' Uhr.',
      'shift_reminder', 'normal', '/c/mein-dienstplan', 'shift', s.id
    FROM carecore_roster_shifts s
    JOIN carecore_schedule_periods p ON p.id = s.period_id AND p.status = 'PUBLISHED'
    JOIN carecore_shift_types st ON st.id = s.shift_type_id
    JOIN carecore_organizations o ON o.id = s.organization_id
    WHERE s.employee_id = ${ctx.actor.id} AND s.organization_id = ${ctx.actor.organizationId} AND s.category <> 'ABSENCE'
      AND s.planned_start > NOW() AND s.planned_start <= NOW() + INTERVAL '24 hours'
      AND NOT EXISTS (SELECT 1 FROM carecore_notifications n
        WHERE n.user_id = s.employee_id AND n.type = 'shift_reminder' AND n.entity_type = 'shift' AND n.entity_id = s.id)`;
  const roster = await rosterContextFrom(ctx);
  await Promise.all([checkMissingClockOuts(roster), expireStaleSwaps(roster)]);
}
