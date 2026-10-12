import { randomUUID } from "node:crypto";
import { ApiError, auditStatement, num, text, type ApiContext, type Row } from "@/lib/api-context";
import {
  QUIZ_MAX_QUESTIONS,
  QUIZ_OPTIONS,
  scoreQuiz,
  type Enrollment,
  type QuizResult,
  type TrainingQuiz,
} from "@/lib/learning-shared";
import { loadTraining, orgToday } from "./learning";

type QuizInput = { passPercent: number; questions: Array<{ question: string; options: string[]; correct: number }> };

// null = Quiz entfernen, undefined = unverändert lassen. Die Bestehensgrenze legt die Einrichtung fest;
// es gibt bewusst keinen Vorgabewert.
export function parseQuiz(input: unknown): QuizInput | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== "object") throw new ApiError("Das Quiz ist ungültig.");
  const body = input as Record<string, unknown>;
  const raw = Array.isArray(body.questions) ? body.questions : [];
  if (!raw.length) return null;
  if (raw.length > QUIZ_MAX_QUESTIONS) throw new ApiError(`Ein Quiz hat höchstens ${QUIZ_MAX_QUESTIONS} Fragen.`);
  const passPercent = num(body.passPercent);
  if (passPercent === null || !Number.isInteger(passPercent) || passPercent < 1 || passPercent > 100)
    throw new ApiError("Bitte die Bestehensgrenze des Quiz festlegen (1–100 %).");
  const questions = raw.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const question = text(item.question, 1000);
    if (question.length < 3) throw new ApiError(`Frage ${index + 1}: Bitte den Fragetext angeben.`);
    const options = (Array.isArray(item.options) ? item.options : []).map((option) => text(option, 300));
    if (options.length < QUIZ_OPTIONS.min || options.length > QUIZ_OPTIONS.max || options.some((option) => !option))
      throw new ApiError(
        `Frage ${index + 1}: Bitte ${QUIZ_OPTIONS.min} bis ${QUIZ_OPTIONS.max} ausgefüllte Antworten angeben.`,
      );
    if (new Set(options).size !== options.length)
      throw new ApiError(`Frage ${index + 1}: Die Antworten müssen sich unterscheiden.`);
    const correct = num(item.correct);
    if (correct === null || !Number.isInteger(correct) || correct < 0 || correct >= options.length)
      throw new ApiError(`Frage ${index + 1}: Bitte die richtige Antwort markieren.`);
    return { question, options, correct };
  });
  return { passPercent, questions };
}

// Anweisungen zum Ersetzen des Quiz (Teil der Transaktion beim Anlegen oder Bearbeiten der Schulung).
export function quizStatements(ctx: ApiContext, trainingId: string, quiz: QuizInput | null) {
  return [
    ctx.sql`DELETE FROM carecore_training_quiz_questions WHERE training_id = ${trainingId}`,
    ctx.sql`UPDATE carecore_trainings SET quiz_pass_percent = ${quiz?.passPercent ?? null} WHERE id = ${trainingId}`,
    ...(quiz?.questions ?? []).map(
      (q, position) => ctx.sql`
        INSERT INTO carecore_training_quiz_questions (id, training_id, position, question, options, correct_option)
        VALUES (${randomUUID()}, ${trainingId}, ${position}, ${q.question}, ${JSON.stringify(q.options)}::jsonb, ${q.correct})`,
    ),
  ];
}

// Quizfragen je Schulung; die richtigen Antworten nur, wenn withAnswers gesetzt ist.
export async function loadQuizzes(ctx: ApiContext, trainingIds: string[], withAnswers: boolean) {
  const quizzes = new Map<string, TrainingQuiz>();
  if (!trainingIds.length) return quizzes;
  const rows = (await ctx.sql`
    SELECT q.id, q.training_id, q.question, q.options, q.correct_option, t.quiz_pass_percent
    FROM carecore_training_quiz_questions q
    JOIN carecore_trainings t ON t.id = q.training_id AND t.organization_id = ${ctx.actor.organizationId}
    WHERE q.training_id = ANY(${trainingIds}::uuid[]) AND t.quiz_pass_percent IS NOT NULL
    ORDER BY q.training_id, q.position`) as Row[];
  for (const row of rows) {
    const id = String(row.training_id);
    const quiz = quizzes.get(id) ?? { passPercent: Number(row.quiz_pass_percent), questions: [] };
    quiz.questions.push({
      id: String(row.id),
      question: String(row.question),
      options: (row.options as unknown[]).map(String),
      correct: withAnswers ? Number(row.correct_option) : null,
    });
    quizzes.set(id, quiz);
  }
  return quizzes;
}

// Quiz ablegen: Bewertung auf dem Server, Versuch und Protokoll immer; bei Bestehen gilt die Schulung
// als abgeschlossen und nachgewiesen (die Prüfung ersetzt die Bestätigung durch die Leitung).
export async function submitQuiz(ctx: ApiContext, enrollment: Enrollment, answersInput: unknown): Promise<QuizResult> {
  if (enrollment.userId !== ctx.actor.id) throw new ApiError("Das Quiz legt nur die angemeldete Person ab.", 403);
  if (enrollment.status === "completed") throw new ApiError("Diese Schulung ist bereits abgeschlossen.", 409);
  const training = await loadTraining(ctx, enrollment.trainingId);
  if (!training.active) throw new ApiError("Diese Schulung wird nicht mehr angeboten.", 409);
  const quiz = (await loadQuizzes(ctx, [enrollment.trainingId], true)).get(enrollment.trainingId);
  if (!quiz) throw new ApiError("Für diese Schulung ist kein Quiz hinterlegt.", 409);
  const answers = Array.isArray(answersInput) ? answersInput.map((answer) => num(answer)) : [];
  if (
    answers.length !== quiz.questions.length ||
    answers.some(
      (answer, index) =>
        answer === null || !Number.isInteger(answer) || answer < 0 || answer >= quiz.questions[index].options.length,
    )
  )
    throw new ApiError("Bitte alle Fragen beantworten.");
  const given = answers as number[];
  const result = scoreQuiz(
    quiz.questions.map((q) => Number(q.correct)),
    given,
    quiz.passPercent,
  );
  const validFor = num(training.valid_for_months);
  const today = await orgToday(ctx);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_training_quiz_attempts (id, enrollment_id, training_id, user_id, answers, correct, total,
        score_percent, pass_percent, passed)
      VALUES (${randomUUID()}, ${enrollment.id}, ${enrollment.trainingId}, ${ctx.actor.id},
        ${JSON.stringify(quiz.questions.map((q, index) => ({ questionId: q.id, answer: given[index] })))}::jsonb,
        ${result.correct}, ${result.total}, ${result.percent}, ${result.passPercent}, ${result.passed})`,
    result.passed
      ? ctx.sql`
        UPDATE carecore_training_enrollments SET status = 'completed', progress = 100, completed_at = NOW(),
          valid_until = CASE WHEN ${validFor}::int IS NULL THEN NULL
            ELSE (${today}::date + make_interval(months => ${validFor}::int))::date END,
          session_id = NULL, due_on = NULL, verified_by = NULL, verified_at = NOW(), quiz_score = ${result.percent},
          quiz_passed_at = NOW(), reminded_at = NULL, updated_at = NOW()
        WHERE id = ${enrollment.id} AND status <> 'completed'`
      : ctx.sql`
        UPDATE carecore_training_enrollments SET quiz_score = ${result.percent},
          status = CASE WHEN status = 'assigned' THEN 'in_progress' ELSE status END, updated_at = NOW()
        WHERE id = ${enrollment.id} AND status <> 'completed'`,
    auditStatement(ctx, "training_enrollment", enrollment.id, result.passed ? "quiz_passed" : "quiz_failed", null, {
      trainingId: enrollment.trainingId,
      correct: result.correct,
      total: result.total,
      percent: result.percent,
      passPercent: result.passPercent,
    }),
  ]);
  return result;
}
