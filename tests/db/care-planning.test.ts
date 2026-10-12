import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { recordAssessment, residentHistory } from "@/lib/assessments";
import { addGoal, addIntervention, evaluateGoal, updateGoal, updateIntervention } from "@/lib/care-plan-goals";
import { createPlan, residentPlan, updatePlan } from "@/lib/care-planning";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

// Kalendertag in Zürich (wie die Organisation der Fixture), damit die Tests auch kurz vor Mitternacht stimmen.
const isoDay = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(Date.now() + offset * 86_400_000));

const residentLog = (residentId: string) =>
  q<{ entity_type: string; action: string }>(
    `SELECT entity_type, action FROM carecore_audit_log
     WHERE entity_id = $1 OR COALESCE(after_data ->> 'residentId', before_data ->> 'residentId') = $1::text
     ORDER BY created_at`,
    [residentId],
  ).then((rows) => rows.map((row) => `${row.entity_type}:${row.action}`));

const goal = (extra: Record<string, unknown> = {}) => ({
  category: "Mobilität",
  problem: "Unsicherer Gang",
  statement: "Geht mit Rollator 20 m sicher",
  targetDate: isoDay(14),
  ...extra,
});

test("Pflegeplan: ein offener Plan je Bewohner, Ziele, Massnahmen und Evaluation im Änderungsprotokoll", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const plan = { residentId, focus: "Sturzprävention", startsOn: isoDay(0), reviewOn: isoDay(30) };
  assert.match((await failure(createPlan(ctx, { ...plan, reviewOn: isoDay(-1) }))).message, /vor dem Startdatum/);
  const planId = await createPlan(ctx, plan);
  assert.equal((await failure(createPlan(ctx, plan))).status, 409, "nur ein offener Plan");
  await updatePlan(ctx, planId, { ...plan, focus: "Sturzprävention und Mobilität" });

  assert.match((await failure(addGoal(ctx, planId, goal({ targetDate: isoDay(-2) })))).message, /Vergangenheit/);
  const goalId = await addGoal(ctx, planId, goal());
  const interventionId = await addIntervention(ctx, goalId, { title: "Gangtraining", frequency: "1× täglich" });
  await updateIntervention(ctx, interventionId, { status: "paused" });
  await updateIntervention(ctx, interventionId, { status: "paused" });
  await evaluateGoal(ctx, goalId, { outcome: "achieved", note: "Geht sicher 25 m" });
  assert.match((await failure(updateGoal(ctx, goalId, { status: "cancelled", reason: "x" }))).message, /Nur aktive/);
  assert.match((await failure(evaluateGoal(ctx, goalId, { outcome: "ongoing", note: "x" }))).message, /Nur aktive/);

  assert.match((await failure(updatePlan(ctx, planId, { status: "closed" }))).message, /Grund/);
  await updatePlan(ctx, planId, { status: "closed", reason: "Ziele erreicht" });
  assert.equal((await failure(addGoal(ctx, planId, goal()))).status, 409, "abgeschlossener Plan");

  assert.deepEqual(await residentLog(residentId), [
    "care_plan:created",
    "care_plan:updated",
    "care_goal:created",
    "intervention:created",
    "intervention:status_paused",
    "care_goal:evaluated",
    "care_plan:status_closed",
  ]);
  // Andere Organisationen sehen den Plan nicht.
  const other = await apiContextFor(await fixture(), "anna");
  assert.equal((await failure(updatePlan(other, planId, { status: "review" }))).status, 404);
  assert.equal((await failure(residentPlan(other, residentId))).status, 404);
});

test("Einschätzung: vollständige Antworten, Folgetermin in der Zukunft, im Änderungsprotokoll", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  assert.match((await failure(recordAssessment(ctx, { residentId, instrument: "XYZ" }))).message, /Unbekannt/);
  assert.match(
    (await failure(recordAssessment(ctx, { residentId, instrument: "NRS", answers: { pain: 11 } }))).message,
    /alle Fragen/,
  );
  assert.match(
    (
      await failure(
        recordAssessment(ctx, { residentId, instrument: "NRS", answers: { pain: 5 }, nextDueOn: isoDay(0) }),
      )
    ).message,
    /Zukunft/,
  );
  const result = await recordAssessment(ctx, { residentId, instrument: "NRS", answers: { pain: 7 } });
  assert.equal(result.score, 7);
  assert.equal(result.riskLabel, "Starker Schmerz");
  assert.equal(result.nextDueOn, isoDay(7));
  assert.equal((await residentHistory(ctx, residentId, "NRS")).length, 1);
  assert.deepEqual(await residentLog(residentId), ["assessment_record:completed"]);
  const other = await apiContextFor(await fixture(), "anna");
  assert.equal((await failure(residentHistory(other, residentId, null))).status, 404);
});
