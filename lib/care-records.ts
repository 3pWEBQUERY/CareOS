import { assertResident, type ApiContext, type Row } from "@/lib/api-context";
import { residentPlan } from "@/lib/care-planning";
import type { PlanStatus } from "@/lib/care-planning-shared";
import type { CareRecordDetail, CareRecordFlag, CareRecordRow, RecordStatus } from "@/lib/care-records-shared";
import { initials } from "@/lib/medication-shared";

// A care record is the resident's open care plan together with its goals,
// interventions and active risk flags; it has no table of its own.

function statusOf(row: Row): RecordStatus {
  if (!row.plan_id) return "Ohne Planung";
  if (row.plan_status === "draft") return "Entwurf";
  if (row.plan_status === "review" || row.review_due || Number(row.goals_due) > 0) return "Evaluation fällig";
  return "Aktuell";
}

export async function careRecordsOverview(ctx: ApiContext): Promise<CareRecordRow[]> {
  const rows = (await ctx.sql`
    SELECT r.id, r.first_name, r.last_name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit,
      p.id AS plan_id, p.status AS plan_status, p.care_level, p.focus, to_char(p.review_on, 'YYYY-MM-DD') AS review_on,
      (p.review_on IS NOT NULL AND p.review_on <= (NOW() AT TIME ZONE org.tz)::date) AS review_due,
      u.display_name AS owner_name,
      (SELECT COUNT(*)::int FROM carecore_care_goals g WHERE g.care_plan_id = p.id AND g.status = 'active') AS active_goals,
      (SELECT COUNT(*)::int FROM carecore_care_goals g WHERE g.care_plan_id = p.id AND g.status = 'active'
        AND g.target_date <= (NOW() AT TIME ZONE org.tz)::date) AS goals_due,
      (SELECT COUNT(*)::int FROM carecore_interventions i JOIN carecore_care_goals g ON g.id = i.care_goal_id
        WHERE g.care_plan_id = p.id AND g.status = 'active' AND i.status = 'active') AS active_interventions,
      (SELECT COUNT(*)::int FROM carecore_resident_clinical_flags f
        WHERE f.resident_id = r.id AND f.active AND f.severity IN ('attention', 'critical')) AS risks
    FROM carecore_residents r
    CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
    LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    LEFT JOIN carecore_care_plans p ON p.resident_id = r.id AND p.status IN ('draft', 'active', 'review')
    LEFT JOIN carecore_users u ON u.id = p.owner_user_id
    WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
    ORDER BY r.last_name, r.first_name`) as Row[];
  return rows.map((row) => {
    const name = `${row.first_name} ${row.last_name}`;
    return {
      id: String(row.id),
      name,
      initials: initials(name),
      room: String(row.room),
      careUnit: String(row.care_unit),
      careLevel: (row.care_level as string | null) ?? null,
      planId: (row.plan_id as string | null) ?? null,
      planStatus: (row.plan_status as PlanStatus | null) ?? null,
      status: statusOf(row),
      focus: (row.focus as string | null) ?? null,
      ownerName: (row.owner_name as string | null) ?? null,
      reviewOn: (row.review_on as string | null) ?? null,
      activeGoals: Number(row.active_goals ?? 0),
      activeInterventions: Number(row.active_interventions ?? 0),
      goalsDue: Number(row.goals_due ?? 0),
      risks: Number(row.risks ?? 0),
    };
  });
}

export async function careRecordDetail(ctx: ApiContext, residentIdInput: unknown): Promise<CareRecordDetail> {
  const residentId = await assertResident(ctx, residentIdInput);
  const [planned, flags, people] = await Promise.all([
    residentPlan(ctx, residentId),
    ctx.sql`
      SELECT id, category, label, severity, details FROM carecore_resident_clinical_flags
      WHERE resident_id = ${residentId} AND active
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END, created_at DESC` as Promise<
      Row[]
    >,
    ctx.sql`
      SELECT u.display_name AS name, 'Bezugspflege' AS role, 0 AS rank
      FROM carecore_care_plans p JOIN carecore_users u ON u.id = p.owner_user_id
      WHERE p.resident_id = ${residentId} AND p.status IN ('draft', 'active', 'review')
      UNION ALL
      SELECT u.display_name, 'Hauptverantwortliche Pflegeperson', 1
      FROM carecore_residents r JOIN carecore_users u ON u.id = r.primary_care_user_id
      WHERE r.id = ${residentId}
      UNION ALL
      SELECT c.full_name, COALESCE(NULLIF(c.relationship, ''), 'Kontaktperson')
        || CASE WHEN c.is_emergency_contact THEN ' · Notfallkontakt' ELSE '' END,
        CASE WHEN c.is_primary THEN 2 ELSE 3 END
      FROM carecore_resident_contacts c WHERE c.resident_id = ${residentId}
      ORDER BY rank, name` as Promise<Row[]>,
  ]);
  const seen = new Set<string>();
  const team = people
    .map((row) => ({ name: String(row.name), role: String(row.role) }))
    .filter((person) => !seen.has(person.name) && seen.add(person.name));
  return {
    ...planned,
    flags: flags.map((row): CareRecordFlag => ({
      id: String(row.id),
      category: String(row.category),
      label: String(row.label),
      severity: row.severity as CareRecordFlag["severity"],
      details: (row.details as string | null) ?? null,
    })),
    team: team.slice(0, 5),
  };
}
