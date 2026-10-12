import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, iso, num, type ApiContext, type Row } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { loadQuizzes } from "@/lib/learning-quiz";
import {
  DUE_SOON_DAYS,
  TRAINING_FORMATS,
  type ComplianceRow,
  type ComplianceState,
  type Enrollment,
  type LearningPayload,
  type LearningPerson,
  type Training,
  type TrainingFormat,
  type TrainingSession,
} from "@/lib/learning-shared";

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const canManage = (ctx: ApiContext) => hasPermission(ctx.actor, "team.manage");
export function requireManage(ctx: ApiContext) {
  if (!canManage(ctx)) throw new ApiError("Nur die Leitung darf Schulungen verwalten.", 403);
}
export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const dayLabel = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

export async function orgToday({ sql, actor }: ApiContext) {
  const rows = (await sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today FROM carecore_organizations WHERE id = ${actor.organizationId}`) as Row[];
  return String(rows[0].today);
}

export async function listPeople({ sql, actor }: ApiContext): Promise<LearningPerson[]> {
  const rows = (await sql`
    SELECT u.id, u.display_name, u.role, COALESCE(p.job_title, '') AS job_title, cu.id AS unit_id, cu.name AS unit_name
    FROM carecore_users u
    JOIN carecore_user_profiles p ON p.user_id = u.id
    LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id
    WHERE p.organization_id = ${actor.organizationId} AND u.active ORDER BY u.display_name`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.display_name),
    role: String(row.role),
    jobTitle: String(row.job_title),
    unitId: (row.unit_id as string | null) ?? null,
    unitName: (row.unit_name as string | null) ?? null,
  }));
}

function mapEnrollment(row: Row): Enrollment {
  return {
    id: String(row.id),
    trainingId: String(row.training_id),
    userId: String(row.user_id),
    userName: String(row.user_name),
    status: row.status === "completed" ? "completed" : row.status === "in_progress" ? "in_progress" : "assigned",
    progress: Number(row.progress),
    dueOn: (row.due_text as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    completedAt: iso(row.completed_at),
    validUntil: (row.valid_text as string | null) ?? null,
    verified: Boolean(row.verified_at),
    verifiedByName: (row.verified_name as string | null) ?? null,
    certificateFileId: (row.certificate_file_id as string | null) ?? null,
    certificateName: (row.cert_name as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    assignedByName: (row.assigned_name as string | null) ?? null,
    quizScore: num(row.quiz_score),
    quizPassedAt: iso(row.quiz_passed_at),
  };
}

export async function selectEnrollments(ctx: ApiContext, where: { userIds?: string[]; id?: string }) {
  const rows = (await ctx.sql`
    SELECT e.*, to_char(e.due_on, 'YYYY-MM-DD') AS due_text, to_char(e.valid_until, 'YYYY-MM-DD') AS valid_text,
      u.display_name AS user_name, v.display_name AS verified_name, a.display_name AS assigned_name, f.name AS cert_name
    FROM carecore_training_enrollments e
    JOIN carecore_trainings t ON t.id = e.training_id AND t.organization_id = ${ctx.actor.organizationId}
    JOIN carecore_users u ON u.id = e.user_id
    LEFT JOIN carecore_users v ON v.id = e.verified_by
    LEFT JOIN carecore_users a ON a.id = e.assigned_by
    LEFT JOIN carecore_cloud_files f ON f.id = e.certificate_file_id
    WHERE (${where.id ?? null}::uuid IS NULL OR e.id = ${where.id ?? null}::uuid)
      AND (${where.userIds ?? null}::uuid[] IS NULL OR e.user_id = ANY(${where.userIds ?? null}::uuid[]))`) as Row[];
  return rows.map(mapEnrollment);
}

function complianceState(enrollment: Enrollment | undefined, today: string): ComplianceState {
  if (!enrollment?.completedAt) return "missing";
  if (enrollment.validUntil && enrollment.validUntil < today) return "expired";
  if (!enrollment.verified) return "pending";
  if (enrollment.validUntil && enrollment.validUntil <= addDays(today, DUE_SOON_DAYS)) return "due_soon";
  return "valid";
}

export async function learningData(ctx: ApiContext, params: URLSearchParams): Promise<LearningPayload> {
  const { sql, actor } = ctx;
  const manager = canManage(ctx);
  const requested = params.get("userId");
  const today = await orgToday(ctx);
  const [people, trainingRows, roleRows] = await Promise.all([
    listPeople(ctx),
    sql`
      SELECT t.*, (SELECT COUNT(*) FROM carecore_training_enrollments e WHERE e.training_id = t.id)::int AS enrolled_count,
        COALESCE((
          SELECT json_agg(json_build_object('id', s.id, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'location', s.location,
            'capacity', s.capacity,
            'booked', (SELECT COUNT(*) FROM carecore_training_enrollments e WHERE e.session_id = s.id AND e.status IN ('assigned', 'in_progress')),
            'mine', EXISTS (SELECT 1 FROM carecore_training_enrollments e WHERE e.session_id = s.id AND e.user_id = ${actor.id}))
            ORDER BY s.starts_at)
          FROM carecore_training_sessions s
          WHERE s.training_id = t.id AND s.cancelled_at IS NULL AND s.ends_at > NOW() - INTERVAL '1 day'), '[]'::json) AS sessions
      FROM carecore_trainings t
      WHERE t.organization_id = ${actor.organizationId} AND t.active
      ORDER BY t.mandatory DESC, t.title` as Promise<Row[]>,
    sql`SELECT key, name FROM carecore_roles
      WHERE system_role OR organization_id = ${actor.organizationId} ORDER BY name` as Promise<Row[]>,
  ]);
  const targets =
    manager && requested === "all"
      ? people
      : manager && requested && people.some((p) => p.id === requested)
        ? people.filter((p) => p.id === requested)
        : people.filter((p) => p.id === actor.id);
  const enrollments = await selectEnrollments(ctx, {
    userIds: [...new Set([actor.id, ...targets.map((p) => p.id)])],
  });
  const byKey = new Map(enrollments.map((e) => [`${e.trainingId}:${e.userId}`, e]));
  const quizzes = await loadQuizzes(
    ctx,
    trainingRows.map((row) => String(row.id)),
    manager,
  );

  const trainings: Training[] = trainingRows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    category: String(row.category),
    format: (row.format as TrainingFormat) in TRAINING_FORMATS ? (row.format as TrainingFormat) : "presence",
    durationMinutes: num(row.duration_minutes),
    mandatory: Boolean(row.mandatory),
    validForMonths: num(row.valid_for_months),
    requiredRoles: Array.isArray(row.required_roles) ? (row.required_roles as string[]) : [],
    linkUrl: (row.link_url as string | null) ?? null,
    quiz: quizzes.get(String(row.id)) ?? null,
    sessions: (row.sessions as TrainingSession[]).map((s) => ({
      ...s,
      startsAt: iso(s.startsAt) ?? "",
      endsAt: iso(s.endsAt) ?? "",
      booked: Number(s.booked),
    })),
    enrollment: byKey.get(`${row.id}:${actor.id}`) ?? null,
    enrolledCount: Number(row.enrolled_count),
  }));

  const compliance: ComplianceRow[] = targets.flatMap((person) =>
    trainings
      .filter((t) => t.mandatory && (!t.requiredRoles.length || t.requiredRoles.includes(person.role)))
      .map((t) => {
        const enrollment = byKey.get(`${t.id}:${person.id}`);
        const state = complianceState(enrollment, today);
        return {
          key: `${t.id}:${person.id}`,
          trainingId: t.id,
          title: t.title,
          description: t.description,
          category: t.category,
          userId: person.id,
          userName: person.name,
          state,
          deadline: enrollment?.completedAt ? enrollment.validUntil : (enrollment?.dueOn ?? null),
          enrollment: enrollment ?? null,
        };
      }),
  );

  return {
    today,
    trainings,
    compliance,
    people: manager ? people : [],
    roles: roleRows.map((row) => ({ key: String(row.key), name: String(row.name) })),
    canManage: manager,
    currentUserId: actor.id,
  };
}

export async function loadTraining(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Schulung");
  const rows = (await ctx.sql`
    SELECT * FROM carecore_trainings WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Schulung nicht gefunden.", 404);
  return rows[0];
}

export async function notify(ctx: ApiContext, userId: string, title: string, body: string, priority = "normal") {
  if (userId === ctx.actor.id) return;
  await ctx.sql`
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
    VALUES (${randomUUID()}, ${userId}, ${title}, ${body}, 'learning', ${priority}, '/c/personal/schulungen')`;
}

// Reminders for own evidence that expires within 30 days or assigned courses due within 7 days.
export async function createLearningReminders(ctx: ApiContext) {
  await ctx.sql`
    WITH today AS (SELECT (NOW() AT TIME ZONE timezone)::date AS d FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}),
    due AS (
      UPDATE carecore_training_enrollments e SET reminded_at = NOW()
      FROM carecore_trainings t, today
      WHERE t.id = e.training_id AND t.organization_id = ${ctx.actor.organizationId} AND t.active AND e.user_id = ${ctx.actor.id}
        AND e.reminded_at IS NULL
        AND ((t.mandatory AND e.valid_until BETWEEN today.d AND today.d + 30)
          OR (e.status <> 'completed' AND e.due_on BETWEEN today.d AND today.d + 7))
      RETURNING t.title, e.valid_until, e.due_on, e.status
    )
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
    SELECT gen_random_uuid(), ${ctx.actor.id},
      CASE WHEN status = 'completed' THEN 'Nachweis läuft ab: ' ELSE 'Schulung fällig: ' END || title,
      CASE WHEN status = 'completed' THEN 'Gültig bis ' || to_char(valid_until, 'DD.MM.YYYY') || '. Auffrischung planen.'
        ELSE 'Frist ' || to_char(due_on, 'DD.MM.YYYY') || '.' END,
      'learning', 'normal', '/c/personal/schulungen/pflichtnachweise'
    FROM due`;
}
