import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { learningData } from "@/lib/learning";
import { enroll, enrollmentAction } from "@/lib/learning-enrollments";
import { createTraining, updateTraining } from "@/lib/learning-trainings";
import { apiContextFor, fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

const questions = [
  { question: "Wie lange Hände desinfizieren?", options: ["5 Sekunden", "30 Sekunden"], correct: 1 },
  { question: "Wann Handschuhe wechseln?", options: ["Nie", "Zwischen Bewohnern", "Einmal pro Schicht"], correct: 1 },
  { question: "Was gehört in den Abwurf?", options: ["Kanülen", "Papier"], correct: 0 },
];

test("Lernen: Quiz verlangt eine Bestehensgrenze und gültige Fragen", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const anna = await apiContextFor(f, "anna");
  const base = { title: "Händehygiene", category: "Hygiene", format: "elearning", mandatory: true };

  assert.equal(await status(createTraining(lead, { ...base, quiz: { questions } })), 400);
  assert.equal(await status(createTraining(lead, { ...base, quiz: { passPercent: 0, questions } })), 400);
  assert.equal(
    await status(
      createTraining(lead, { ...base, quiz: { passPercent: 80, questions: [{ ...questions[0], correct: 5 }] } }),
    ),
    400,
  );
  assert.equal(
    await status(
      createTraining(lead, {
        ...base,
        quiz: { passPercent: 80, questions: [{ ...questions[0], options: ["Ja", "Ja"] }] },
      }),
    ),
    400,
  );
  assert.equal(await status(createTraining(anna, { ...base, quiz: { passPercent: 80, questions } })), 403);

  const id = await createTraining(lead, { ...base, quiz: { passPercent: 60, questions } });
  const managed = (await learningData(lead, new URLSearchParams())).trainings.find((t) => t.id === id)!;
  assert.equal(managed.quiz?.passPercent, 60);
  assert.deepEqual(
    managed.quiz?.questions.map((qq) => qq.correct),
    [1, 1, 0],
  );
  // Mitarbeitende sehen die Fragen, aber nicht die richtigen Antworten.
  const own = (await learningData(anna, new URLSearchParams())).trainings.find((t) => t.id === id)!;
  assert.deepEqual(
    own.quiz?.questions.map((qq) => qq.correct),
    [null, null, null],
  );

  // Bearbeiten ohne quiz lässt das Quiz stehen, null entfernt es.
  await updateTraining(lead, id, { ...base, title: "Händehygiene 2026" });
  assert.equal(
    (await learningData(lead, new URLSearchParams())).trainings.find((t) => t.id === id)?.quiz?.questions.length,
    3,
  );
  await updateTraining(lead, id, { ...base, quiz: null });
  assert.equal((await learningData(lead, new URLSearchParams())).trainings.find((t) => t.id === id)?.quiz, null);
});

test("Lernen: Quiz bestehen schliesst die Schulung ab, Nichtbestehen nicht", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const anna = await apiContextFor(f, "anna");
  const max = await apiContextFor(f, "max");
  const id = await createTraining(lead, {
    title: "Händehygiene",
    category: "Hygiene",
    format: "elearning",
    mandatory: true,
    validForMonths: 12,
    quiz: { passPercent: 60, questions },
  });
  await enroll(anna, { trainingId: id });
  const enrollmentId = (await learningData(anna, new URLSearchParams())).trainings.find((t) => t.id === id)!.enrollment!
    .id;

  assert.equal(await status(enrollmentAction(anna, enrollmentId, { action: "quiz", answers: [1, 1] })), 400);
  assert.equal(await status(enrollmentAction(anna, enrollmentId, { action: "quiz", answers: [1, 1, 7] })), 400);
  assert.equal(await status(enrollmentAction(max, enrollmentId, { action: "quiz", answers: [1, 1, 0] })), 403);

  const failed = await enrollmentAction(anna, enrollmentId, { action: "quiz", answers: [0, 0, 0] });
  assert.deepEqual(failed, { correct: 1, total: 3, percent: 33, passPercent: 60, passed: false });
  const row = (
    await q<{ status: string; quiz_score: number; completed_at: Date | null }>(
      "SELECT status, quiz_score, completed_at FROM carecore_training_enrollments WHERE id = $1",
      [enrollmentId],
    )
  )[0];
  assert.equal(row.status, "in_progress");
  assert.equal(row.quiz_score, 33);
  assert.equal(row.completed_at, null);

  const passed = await enrollmentAction(anna, enrollmentId, { action: "quiz", answers: [1, 1, 1] });
  assert.equal((passed as { passed: boolean }).passed, true);
  const data = await learningData(anna, new URLSearchParams());
  const enrollment = data.trainings.find((t) => t.id === id)!.enrollment!;
  assert.equal(enrollment.status, "completed");
  assert.equal(enrollment.verified, true);
  assert.equal(enrollment.quizScore, 66);
  assert.ok(enrollment.quizPassedAt);
  assert.equal(enrollment.validUntil?.slice(0, 4), String(Number(data.today.slice(0, 4)) + 1));
  assert.equal(data.compliance.find((c) => c.trainingId === id)?.state, "valid");

  assert.equal(await status(enrollmentAction(anna, enrollmentId, { action: "quiz", answers: [1, 1, 0] })), 409);
  const attempts = await q<{ passed: boolean; score_percent: number }>(
    "SELECT passed, score_percent FROM carecore_training_quiz_attempts WHERE enrollment_id = $1 ORDER BY created_at",
    [enrollmentId],
  );
  assert.deepEqual(
    attempts.map((a) => [a.passed, a.score_percent]),
    [
      [false, 33],
      [true, 66],
    ],
  );
  const audit = await q<{ action: string }>(
    "SELECT action FROM carecore_audit_log WHERE entity_id = $1 AND action LIKE 'quiz_%' ORDER BY created_at",
    [enrollmentId],
  );
  assert.deepEqual(
    audit.map((a) => a.action),
    ["quiz_failed", "quiz_passed"],
  );
});

test("Lernen: Pflichtnachweise tragen den Stammwohnbereich für die Übersicht je Team", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  await createTraining(lead, { title: "Notfallkurs", category: "Notfall", format: "presence", mandatory: true });
  const data = await learningData(lead, new URLSearchParams("userId=all"));
  const people = new Map(data.people.map((p) => [p.id, p.unitName]));
  assert.equal(people.get(f.people.anna), "Wohngruppe A");
  assert.equal(people.get(f.people.ben), "Wohngruppe B");
  assert.ok(data.compliance.some((row) => row.userId === f.people.ben));
  // Ohne Leitungsrecht keine Personenliste und nur die eigenen Nachweise.
  const anna = await learningData(await apiContextFor(f, "anna"), new URLSearchParams("userId=all"));
  assert.deepEqual(anna.people, []);
  assert.ok(anna.compliance.every((row) => row.userId === f.people.anna));
});
