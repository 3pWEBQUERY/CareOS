import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, num, text, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { TRAINING_CATEGORIES, TRAINING_FORMATS, type TrainingFormat } from "@/lib/learning-shared";
import { requireManage, loadTraining, DATE, TIME, orgToday, notify } from "./learning";
import { parseQuiz, quizStatements } from "./learning-quiz";

export function parseTraining(body: Record<string, unknown>, roleKeys: string[]) {
  const title = text(body.title, 220);
  if (title.length < 3) throw new ApiError("Bitte einen Titel angeben.");
  const category =
    typeof body.category === "string" && (TRAINING_CATEGORIES as readonly string[]).includes(body.category)
      ? body.category
      : "Pflege";
  const format =
    typeof body.format === "string" && body.format in TRAINING_FORMATS ? (body.format as TrainingFormat) : "presence";
  const duration = num(body.durationMinutes);
  if (duration !== null && (!Number.isInteger(duration) || duration < 5 || duration > 2400))
    throw new ApiError("Die Dauer muss zwischen 5 und 2400 Minuten liegen.");
  const validFor = num(body.validForMonths);
  if (validFor !== null && (!Number.isInteger(validFor) || validFor < 1 || validFor > 120))
    throw new ApiError("Die Gültigkeit muss zwischen 1 und 120 Monaten liegen.");
  const link = text(body.linkUrl, 1000);
  if (link && !/^https:\/\/[^\s]+$/i.test(link)) throw new ApiError("Der Kurslink muss mit https:// beginnen.");
  const roles = Array.isArray(body.requiredRoles)
    ? [...new Set(body.requiredRoles.filter((r): r is string => typeof r === "string" && roleKeys.includes(r)))]
    : [];
  return {
    title,
    description: text(body.description, 5000) || null,
    category,
    format,
    duration,
    mandatory: body.mandatory === true,
    validFor,
    link: link || null,
    roles,
  };
}

export async function roleKeys(ctx: ApiContext) {
  return (
    (await ctx.sql`
      SELECT key FROM carecore_roles WHERE system_role OR organization_id = ${ctx.actor.organizationId}`) as Row[]
  ).map((row) => String(row.key));
}

export async function createTraining(ctx: ApiContext, body: Record<string, unknown>) {
  requireManage(ctx);
  const t = parseTraining(body, await roleKeys(ctx));
  const quiz = parseQuiz(body.quiz);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_trainings (id, organization_id, title, description, category, format, duration_minutes, mandatory,
      valid_for_months, link_url, required_roles, created_by)
    VALUES (${id}, ${ctx.actor.organizationId}, ${t.title}, ${t.description}, ${t.category}, ${t.format}, ${t.duration},
      ${t.mandatory}, ${t.validFor}, ${t.link}, ${JSON.stringify(t.roles)}::jsonb, ${ctx.actor.id})`,
    ...(quiz ? quizStatements(ctx, id, quiz) : []),
    auditStatement(ctx, "training", id, "created", null, { ...t, quiz: quiz ?? null }),
  ]);
  return id;
}

export async function updateTraining(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  requireManage(ctx);
  const before = await loadTraining(ctx, idInput);
  if (body.action === "archive") {
    await ctx.sql.transaction([
      ctx.sql`UPDATE carecore_trainings SET active = FALSE, updated_at = NOW() WHERE id = ${before.id as string}`,
      auditStatement(ctx, "training", String(before.id), "archived", null, null),
    ]);
    return;
  }
  const t = parseTraining(body, await roleKeys(ctx));
  const quiz = parseQuiz(body.quiz);
  await ctx.sql.transaction([
    ctx.sql`
    UPDATE carecore_trainings SET title = ${t.title}, description = ${t.description}, category = ${t.category},
      format = ${t.format}, duration_minutes = ${t.duration}, mandatory = ${t.mandatory}, valid_for_months = ${t.validFor},
      link_url = ${t.link}, required_roles = ${JSON.stringify(t.roles)}::jsonb, updated_at = NOW()
    WHERE id = ${before.id as string}`,
    ...(quiz === undefined ? [] : quizStatements(ctx, String(before.id), quiz)),
    auditStatement(ctx, "training", String(before.id), "updated", before, quiz === undefined ? t : { ...t, quiz }),
  ]);
}

export async function addSession(ctx: ApiContext, trainingIdInput: unknown, body: Record<string, unknown>) {
  requireManage(ctx);
  const training = await loadTraining(ctx, trainingIdInput);
  if (typeof body.date !== "string" || !DATE.test(body.date)) throw new ApiError("Bitte das Datum wählen.");
  const start = typeof body.start === "string" && TIME.test(body.start) ? body.start : "";
  const end = typeof body.end === "string" && TIME.test(body.end) ? body.end : "";
  if (!start || !end || end <= start) throw new ApiError("Bitte gültige Anfangs- und Endzeiten angeben.");
  if (body.date < (await orgToday(ctx))) throw new ApiError("Termine können nicht in der Vergangenheit liegen.");
  const capacity = num(body.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 500))
    throw new ApiError("Die Platzzahl muss zwischen 1 und 500 liegen.");
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_training_sessions (id, training_id, starts_at, ends_at, location, capacity)
    SELECT ${id}, ${training.id as string}, (${body.date}::date + ${start}::time) AT TIME ZONE timezone,
      (${body.date}::date + ${end}::time) AT TIME ZONE timezone, ${text(body.location, 180) || null}, ${capacity}
    FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "training_session", id, "created", null, {
      trainingId: training.id,
      date: body.date,
      start,
      end,
    }),
  ]);
  return id;
}

export async function cancelSession(ctx: ApiContext, sessionIdInput: unknown) {
  requireManage(ctx);
  const id = assertUuid(sessionIdInput, "Termin");
  const rows = (await ctx.sql`
    SELECT s.id, t.title, s.starts_at FROM carecore_training_sessions s JOIN carecore_trainings t ON t.id = s.training_id
    WHERE s.id = ${id} AND t.organization_id = ${ctx.actor.organizationId} AND s.cancelled_at IS NULL`) as Row[];
  if (!rows[0]) throw new ApiError("Termin nicht gefunden.", 404);
  const affected = (await ctx.sql`
    UPDATE carecore_training_enrollments SET session_id = NULL, updated_at = NOW() WHERE session_id = ${id} RETURNING user_id`) as Row[];
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_training_sessions SET cancelled_at = NOW() WHERE id = ${id}`,
    auditStatement(ctx, "training_session", id, "cancelled", null, { affected: affected.length }),
  ]);
  for (const row of affected)
    await notify(
      ctx,
      String(row.user_id),
      `Kurstermin abgesagt: ${rows[0].title}`,
      "Bitte einen anderen Termin wählen.",
      "high",
    );
}
