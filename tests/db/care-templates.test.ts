import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { addGoal } from "@/lib/care-plan-goals";
import { createPlan, residentPlan } from "@/lib/care-planning";
import { careTemplates, createTemplate, updateTemplate } from "@/lib/care-templates";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

const isoDay = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(Date.now() + offset * 86_400_000));

const withQuality = (ctx: ApiContext) =>
  ({
    ...ctx,
    actor: { ...ctx.actor, permissions: [...new Set([...ctx.actor.permissions, "quality.manage"])] },
  }) as ApiContext;

const standard = {
  kind: "goal",
  category: "Mobilität",
  title: "Gangunsicherheit",
  problem: "Unsicherer Gang, Angst vor Sturz",
  resources: "Motiviert",
  statement: "Geht mit Rollator 20 m sicher",
  reviewDays: 28,
  interventions: [
    { title: "Gehtraining im Korridor", frequency: "täglich", responsibleRole: "Pflege", dayParts: ["morning", "x"] },
    { title: "Rollator bereitstellen", frequency: "bei Bedarf", instructions: "In Reichweite stellen" },
  ],
};

test("Vorlagen: pflegen mit Recht „Qualität“, Prüfungen, ausblenden und lesen beim Planen", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const quality = withQuality(await apiContextFor(f, "leadA"));
  assert.equal((await failure(createTemplate(nurse, standard))).status, 403);
  assert.match((await failure(createTemplate(quality, { ...standard, category: "x" }))).message, /Pflegebereich/);
  assert.match((await failure(createTemplate(quality, { ...standard, title: "" }))).message, /Namen/);
  assert.match((await failure(createTemplate(quality, { ...standard, reviewDays: 0 }))).message, /1 bis 365/);
  assert.match(
    (await failure(createTemplate(quality, { ...standard, interventions: [{ title: "Ohne Häufigkeit" }] }))).message,
    /Häufigkeit/,
  );
  const goalTemplate = await createTemplate(quality, standard);
  const catalog = await createTemplate(quality, {
    kind: "intervention",
    category: "Mobilität",
    title: "Hüftprotektor anziehen",
    frequency: "morgens",
    dayParts: ["morning"],
  });
  let templates = await careTemplates(nurse);
  assert.equal(templates.canManage, false);
  assert.deepEqual(
    templates.goals.map((entry) => [entry.title, entry.reviewDays, entry.interventions.length]),
    [["Gangunsicherheit", 28, 2]],
  );
  assert.deepEqual(templates.goals[0].interventions[0].dayParts, ["morning"], "nur gültige Tageszeiten");
  assert.deepEqual(
    templates.interventions.map((entry) => [entry.title, entry.dayParts]),
    [["Hüftprotektor anziehen", ["morning"]]],
  );
  await updateTemplate(quality, goalTemplate.id, { ...standard, title: "Gangunsicherheit nach Spital" });
  await updateTemplate(quality, catalog.id, { kind: "intervention", archive: true });
  templates = await careTemplates(quality);
  assert.equal(templates.canManage, true);
  assert.equal(templates.goals[0].title, "Gangunsicherheit nach Spital");
  assert.deepEqual(templates.interventions, [], "ausgeblendete Massnahmen werden nicht mehr angeboten");
  assert.equal(
    (await failure(updateTemplate(quality, catalog.id, { kind: "intervention", archive: true }))).status,
    404,
  );

  // Beim Planen: Ziel aus der Vorlage mit gewählten Massnahmen in einem Schritt; Herkunft festgehalten.
  const residentId = await createResident(f);
  const planId = await createPlan(nurse, { residentId, focus: "Sturz", startsOn: isoDay(0), reviewOn: isoDay(30) });
  const used = templates.goals[0];
  const goalId = await addGoal(nurse, planId, {
    category: used.category,
    problem: `${used.problem} (seit Spital)`,
    resources: used.resources,
    statement: used.statement,
    targetDate: isoDay(used.reviewDays ?? 28),
    templateId: used.id,
    interventions: [used.interventions[0]],
  });
  const plan = await residentPlan(nurse, residentId);
  const goal = plan.plan?.goals.find((entry) => entry.id === goalId);
  assert.equal(goal?.problem, "Unsicherer Gang, Angst vor Sturz (seit Spital)", "angepasste Kopie");
  assert.deepEqual(
    goal?.interventions.map((entry) => [entry.title, entry.frequency, entry.dayParts]),
    [["Gehtraining im Korridor", "täglich", ["morning"]]],
  );
  const [row] = await q<{ template_id: string }>(`SELECT template_id FROM carecore_care_goals WHERE id = $1`, [goalId]);
  assert.equal(row.template_id, used.id);
  const log = await q<{ entity_type: string }>(
    `SELECT entity_type FROM carecore_audit_log WHERE after_data->>'goalId' = $1 OR entity_id = $1::uuid ORDER BY created_at`,
    [goalId],
  );
  assert.deepEqual(
    log.map((entry) => entry.entity_type),
    ["care_goal", "intervention"],
  );

  // Vorlagen anderer Einrichtungen werden abgewiesen; ungültige Massnahmen verhindern das ganze Ziel.
  const other = withQuality(await apiContextFor(await fixture(), "leadA"));
  const foreign = await createTemplate(other, standard);
  const base = { category: "Mobilität", problem: "P", statement: "Z", targetDate: isoDay(7) };
  assert.equal((await failure(addGoal(nurse, planId, { ...base, templateId: foreign.id }))).status, 404);
  assert.match(
    (await failure(addGoal(nurse, planId, { ...base, interventions: [{ title: "ohne" }] }))).message,
    /Häufigkeit/,
  );
  assert.equal((await residentPlan(nurse, residentId)).plan?.goals.length, 1);
  assert.equal((await careTemplates(other)).goals.length, 1, "jede Einrichtung sieht nur ihre Vorlagen");
});
