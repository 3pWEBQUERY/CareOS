import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, iso, num, text, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { notifyStatements } from "@/lib/notify";
import { storeFile } from "@/lib/files";
import { CERTIFICATE_TYPES } from "@/lib/learning-shared";
import {
  loadTraining,
  requireManage,
  DATE,
  orgToday,
  listPeople,
  notify,
  dayLabel,
  selectEnrollments,
  canManage,
  addDays,
} from "./learning";
import { submitQuiz } from "./learning-quiz";

export async function checkSession(ctx: ApiContext, trainingId: string, sessionIdInput: unknown) {
  if (!sessionIdInput) return null;
  const sessionId = assertUuid(sessionIdInput, "Termin");
  const rows = (await ctx.sql`
    SELECT s.capacity, s.starts_at,
      (SELECT COUNT(*) FROM carecore_training_enrollments e WHERE e.session_id = s.id AND e.status IN ('assigned', 'in_progress') AND e.user_id <> ${ctx.actor.id})::int AS booked
    FROM carecore_training_sessions s WHERE s.id = ${sessionId} AND s.training_id = ${trainingId} AND s.cancelled_at IS NULL`) as Row[];
  if (!rows[0]) throw new ApiError("Termin nicht gefunden.", 404);
  if (Date.parse(String(iso(rows[0].starts_at))) < Date.now())
    throw new ApiError("Dieser Termin hat bereits begonnen.", 409);
  if (rows[0].capacity !== null && Number(rows[0].booked) >= Number(rows[0].capacity))
    throw new ApiError("Dieser Termin ist ausgebucht.", 409);
  return sessionId;
}

export async function enroll(ctx: ApiContext, body: Record<string, unknown>) {
  const training = await loadTraining(ctx, body.trainingId);
  if (!training.active) throw new ApiError("Diese Schulung wird nicht mehr angeboten.", 409);
  const sessionId = await checkSession(ctx, String(training.id), body.sessionId);
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_training_enrollments (id, training_id, user_id, status, session_id)
    VALUES (${randomUUID()}, ${training.id as string}, ${ctx.actor.id}, 'assigned', ${sessionId})
    ON CONFLICT (training_id, user_id) DO UPDATE SET session_id = EXCLUDED.session_id,
      status = CASE WHEN carecore_training_enrollments.status = 'completed' THEN 'assigned' ELSE carecore_training_enrollments.status END,
      progress = CASE WHEN carecore_training_enrollments.status = 'completed' THEN 0 ELSE carecore_training_enrollments.progress END,
      quiz_score = CASE WHEN carecore_training_enrollments.status = 'completed' THEN NULL ELSE carecore_training_enrollments.quiz_score END,
      updated_at = NOW()`,
    auditStatement(ctx, "training_enrollment", String(training.id), "enrolled", null, { sessionId }),
  ]);
}

export async function assignTraining(ctx: ApiContext, trainingIdInput: unknown, body: Record<string, unknown>) {
  requireManage(ctx);
  const training = await loadTraining(ctx, trainingIdInput);
  const dueOn = typeof body.dueOn === "string" && DATE.test(body.dueOn) ? body.dueOn : null;
  if (dueOn && dueOn < (await orgToday(ctx))) throw new ApiError("Die Frist liegt in der Vergangenheit.");
  const people = new Set((await listPeople(ctx)).map((p) => p.id));
  const userIds = Array.isArray(body.userIds)
    ? [...new Set(body.userIds.filter((id): id is string => typeof id === "string" && people.has(id)))]
    : [];
  if (!userIds.length) throw new ApiError("Bitte mindestens eine Person wählen.");
  // Zuweisung, Protokoll und Benachrichtigungen gemeinsam.
  await ctx.sql.transaction([
    ...userIds.map(
      (userId) => ctx.sql`
        INSERT INTO carecore_training_enrollments (id, training_id, user_id, status, due_on, assigned_by)
        VALUES (${randomUUID()}, ${training.id as string}, ${userId}, 'assigned', ${dueOn}, ${ctx.actor.id})
        ON CONFLICT (training_id, user_id) DO UPDATE SET due_on = EXCLUDED.due_on, assigned_by = EXCLUDED.assigned_by,
          status = CASE WHEN carecore_training_enrollments.status = 'completed' THEN 'assigned' ELSE carecore_training_enrollments.status END,
          progress = CASE WHEN carecore_training_enrollments.status = 'completed' THEN 0 ELSE carecore_training_enrollments.progress END,
          quiz_score = CASE WHEN carecore_training_enrollments.status = 'completed' THEN NULL ELSE carecore_training_enrollments.quiz_score END,
          updated_at = NOW()`,
    ),
    auditStatement(ctx, "training", String(training.id), "assigned", null, { userIds, dueOn }),
    ...notifyStatements(
      ctx,
      userIds,
      `Schulung zugewiesen: ${training.title}`,
      dueOn ? `Bitte bis ${dayLabel(dueOn)} abschliessen.` : "Bitte im Kurskatalog anmelden.",
      "learning",
      "/c/personal/schulungen",
    ),
  ]);
  return userIds.length;
}

export async function enrollmentAction(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  const id = assertUuid(idInput, "Anmeldung");
  const enrollment = (await selectEnrollments(ctx, { id }))[0];
  if (!enrollment) throw new ApiError("Anmeldung nicht gefunden.", 404);
  const own = enrollment.userId === ctx.actor.id;
  if (body.action === "quiz") return submitQuiz(ctx, enrollment, body.answers);
  if (body.action === "progress") {
    if (!own) throw new ApiError("Nur die angemeldete Person kann den Fortschritt melden.", 403);
    const progress = num(body.progress);
    if (progress === null || !Number.isInteger(progress) || progress < 0 || progress > 100)
      throw new ApiError("Der Fortschritt muss zwischen 0 und 100 % liegen.");
    await ctx.sql`
      UPDATE carecore_training_enrollments SET progress = ${progress},
        status = CASE WHEN status = 'completed' THEN status WHEN ${progress} > 0 THEN 'in_progress' ELSE 'assigned' END,
        updated_at = NOW() WHERE id = ${id}`;
    return;
  }
  if (body.action === "withdraw") {
    if (!own && !canManage(ctx)) throw new ApiError("Nur die angemeldete Person oder die Leitung kann abmelden.", 403);
    if (own && enrollment.assignedByName && !canManage(ctx))
      throw new ApiError("Zugewiesene Schulungen kann nur die Leitung zurücknehmen.", 403);
    await ctx.sql.transaction([
      enrollment.completedAt
        ? ctx.sql`
          UPDATE carecore_training_enrollments SET status = 'completed', session_id = NULL, progress = 100, due_on = NULL, updated_at = NOW()
          WHERE id = ${id}`
        : ctx.sql`DELETE FROM carecore_training_enrollments WHERE id = ${id}`,
      auditStatement(ctx, "training_enrollment", id, "withdrawn", enrollment, null),
    ]);
    return;
  }
  if (body.action === "verify") {
    requireManage(ctx);
    if (!enrollment.completedAt) throw new ApiError("Es liegt noch kein Nachweis vor.", 409);
    await ctx.sql.transaction([
      ctx.sql`
      UPDATE carecore_training_enrollments SET verified_by = ${ctx.actor.id}, verified_at = NOW(), updated_at = NOW() WHERE id = ${id}`,
      auditStatement(ctx, "training_enrollment", id, "verified", null, null),
    ]);
    await notify(ctx, enrollment.userId, "Nachweis bestätigt", "Dein Schulungsnachweis wurde von der Leitung geprüft.");
    return;
  }
  throw new ApiError("Unbekannte Aktion.");
}

// Records completion evidence (optionally with a certificate). Entries by the leadership count as verified.
export async function recordEvidence(ctx: ApiContext, form: FormData) {
  const training = await loadTraining(ctx, form.get("trainingId"));
  const manager = canManage(ctx);
  const userId = form.get("userId") ? assertUuid(form.get("userId"), "Person") : ctx.actor.id;
  if (userId !== ctx.actor.id && !manager) throw new ApiError("Nachweise für andere erfasst nur die Leitung.", 403);
  if (!(await listPeople(ctx)).some((p) => p.id === userId)) throw new ApiError("Person nicht gefunden.", 404);
  const completedOn = String(form.get("completedOn") ?? "");
  const today = await orgToday(ctx);
  if (!DATE.test(completedOn)) throw new ApiError("Bitte das Abschlussdatum angeben.");
  if (completedOn > today) throw new ApiError("Das Abschlussdatum liegt in der Zukunft.");
  if (completedOn < addDays(today, -365 * 5)) throw new ApiError("Nachweise älter als 5 Jahre werden nicht erfasst.");
  const file = form.get("certificate");
  const certificate =
    file instanceof File && file.size > 0 ? await storeFile(ctx, file, "certificate", CERTIFICATE_TYPES) : null;
  const note = text(form.get("note"), 1000) || null;
  const validFor = num(training.valid_for_months);
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_training_enrollments (id, training_id, user_id, status, progress, completed_at, valid_until,
      certificate_file_id, verified_by, verified_at, note)
    VALUES (${randomUUID()}, ${training.id as string}, ${userId}, 'completed', 100, (${completedOn}::date + TIME '12:00'),
      CASE WHEN ${validFor}::int IS NULL THEN NULL ELSE (${completedOn}::date + make_interval(months => ${validFor}::int))::date END,
      ${certificate?.id ?? null}, ${manager ? ctx.actor.id : null}, ${manager ? new Date().toISOString() : null}, ${note})
    ON CONFLICT (training_id, user_id) DO UPDATE SET status = 'completed', progress = 100, session_id = NULL, due_on = NULL,
      completed_at = EXCLUDED.completed_at, valid_until = EXCLUDED.valid_until,
      certificate_file_id = COALESCE(EXCLUDED.certificate_file_id, carecore_training_enrollments.certificate_file_id),
      verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at, note = EXCLUDED.note,
      reminded_at = NULL, updated_at = NOW()`,
    auditStatement(ctx, "training_evidence", String(training.id), "recorded", null, {
      userId,
      completedOn,
      certificate: certificate?.name ?? null,
      verified: manager,
    }),
  ]);
  if (!manager && training.mandatory) {
    const managers = (await ctx.sql`
      SELECT u.id FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id JOIN carecore_roles r ON r.key = u.role
      WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active AND r.permissions ? 'team.manage'`) as Row[];
    for (const m of managers)
      await ctx.sql`
        INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
        VALUES (${randomUUID()}, ${String(m.id)}, ${`Nachweis zur Prüfung: ${training.title}`},
          ${`${ctx.actor.display_name} hat einen Nachweis erfasst.`}, 'learning', 'normal', '/c/personal/schulungen/pflichtnachweise')`;
  }
}
