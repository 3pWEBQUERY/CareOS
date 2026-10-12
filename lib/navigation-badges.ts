import type { ApiContext, Row } from "@/lib/api-context";
import { listRound } from "@/lib/medication-round";
import { ROUNDS, type RoundKey } from "@/lib/medication-shared";
import { readSettings } from "@/lib/settings";

// Counts shown as badges in the sidebar: my open tasks due today, unread handover
// notes of the last 72 hours and overdue scheduled doses. Switched off in
// "Leitung · Konfiguration", all counts are zero. Unread messenger messages are counted too.
export type NavigationBadges = { tasks: number; handover: number; medRound: number; messages: number };

export async function navigationBadges(ctx: ApiContext): Promise<NavigationBadges> {
  const settings = await readSettings(ctx);
  if (!settings.navigationBadges.enabled) return { tasks: 0, handover: 0, medRound: 0, messages: 0 };
  const [counts, rounds] = await Promise.all([
    ctx.sql`
      SELECT
        (SELECT COUNT(*) FROM carecore_tasks t, carecore_organizations o
          WHERE o.id = t.organization_id AND t.organization_id = ${ctx.actor.organizationId}
            AND t.assigned_to = ${ctx.actor.id} AND t.status IN ('open', 'in_progress', 'escalated')
            AND (t.due_at IS NULL OR t.due_at < ((NOW() AT TIME ZONE o.timezone)::date + 1) AT TIME ZONE o.timezone))::int AS tasks,
        (SELECT COUNT(*) FROM carecore_handovers h
          WHERE h.organization_id = ${ctx.actor.organizationId} AND h.created_at > NOW() - INTERVAL '72 hours'
            AND h.author_user_id IS DISTINCT FROM ${ctx.actor.id}
            AND NOT EXISTS (SELECT 1 FROM carecore_handover_reads r WHERE r.handover_id = h.id AND r.user_id = ${ctx.actor.id}))::int AS handover,
        (SELECT COUNT(*) FROM carecore_conversation_members cm
          INNER JOIN carecore_messages m ON m.conversation_id = cm.conversation_id
            AND m.created_at > COALESCE(cm.last_read_at, 'epoch'::timestamptz) AND m.author_user_id <> ${ctx.actor.id}
          WHERE cm.user_id = ${ctx.actor.id})::int AS messages` as Promise<Row[]>,
    Promise.all((Object.keys(ROUNDS) as RoundKey[]).map((round) => listRound(ctx, round, null))),
  ]);
  const overdue = settings.medicationOverdue;
  const limit = overdue.enabled ? Date.now() - (overdue.value ?? 30) * 60_000 : -Infinity;
  return {
    tasks: Number(counts[0]?.tasks ?? 0),
    handover: Number(counts[0]?.handover ?? 0),
    messages: Number(counts[0]?.messages ?? 0),
    medRound: rounds
      .flatMap((round) => round.doses)
      .filter((dose) => dose.status === "scheduled" && Date.parse(dose.scheduledAt) < limit).length,
  };
}
