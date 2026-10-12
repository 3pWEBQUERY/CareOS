import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import {
  completeOnboarding,
  onboardingOverview,
  saveOnboardingChecklist,
  signOnboardingStep,
  startOnboarding,
} from "@/lib/onboarding";
import { apiContextFor, fixture, q } from "../support/db";

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  assert.fail("Fehler erwartet");
}

test("Einarbeitung: Checklisten je Rolle, Start übernimmt Punkte, Abzeichnen durch einarbeitende Person, Abschluss", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const mentor = await apiContextFor(f, "anna");
  const newcomer = await apiContextFor(f, "max");
  const other = await apiContextFor(f, "lea");

  // Keine Vorgabe: ohne Checkliste kein Start.
  assert.deepEqual((await onboardingOverview(lead)).checklists, {});
  const start = { userId: f.people.max, mentorId: f.people.anna, startedOn: "2026-10-01" };
  assert.match((await failure(startOnboarding(lead, start))).message, /noch keine Checkliste festgelegt/);
  assert.equal((await failure(saveOnboardingChecklist(mentor, { role: "", items: ["x"] }))).status, 403);
  assert.equal(
    (await failure(saveOnboardingChecklist(lead, { role: "", items: ["Rundgang", "rundgang"] }))).message,
    "Jeder Punkt darf nur einmal vorkommen.",
  );
  assert.equal((await failure(saveOnboardingChecklist(lead, { role: "gibt-es-nicht", items: ["x"] }))).status, 404);
  await saveOnboardingChecklist(lead, { role: "", items: ["Rundgang durch das Haus", " Brandschutz ", ""] });
  await saveOnboardingChecklist(lead, { role: "pflege", items: ["Einführung Pflegedokumentation", "Brandschutz"] });
  await saveOnboardingChecklist(lead, { role: "leitung", items: ["Dienstplan"] });
  const lists = (await onboardingOverview(lead)).checklists;
  assert.deepEqual(lists[""], ["Rundgang durch das Haus", "Brandschutz"]);
  assert.deepEqual(lists.pflege, ["Einführung Pflegedokumentation", "Brandschutz"]);

  assert.equal((await failure(startOnboarding(mentor, start))).status, 403);
  assert.equal(
    (await failure(startOnboarding(lead, { ...start, mentorId: f.people.max }))).message,
    "Die einarbeitende Person muss jemand anderes sein.",
  );
  const { id } = await startOnboarding(lead, { ...start, note: "Teilzeit 60 %" });
  assert.equal((await failure(startOnboarding(lead, start))).status, 409, "nur eine laufende Einarbeitung je Person");

  // Punkte für alle Rollen und der Rolle, doppelte nur einmal; spätere Änderungen betreffen sie nicht.
  await saveOnboardingChecklist(lead, { role: "pflege", items: ["Neuer Punkt"] });
  let overview = await onboardingOverview(lead);
  let onboarding = overview.onboardings.find((item) => item.id === id)!;
  assert.deepEqual(
    onboarding.steps.map((step) => step.title),
    ["Rundgang durch das Haus", "Brandschutz", "Einführung Pflegedokumentation"],
  );
  assert.equal(onboarding.mentorName, "Anna Müller");
  assert.equal(onboarding.roleName.length > 0, true);

  // Hinweis an die einarbeitende Person.
  const notes = await q<{ title: string }>(
    `SELECT title FROM carecore_notifications WHERE user_id = $1 AND type = 'onboarding_mentor'`,
    [f.people.anna],
  );
  assert.deepEqual(
    notes.map((row) => row.title),
    ["Einarbeitung: Max Meier"],
  );

  // Sichtbarkeit: Leitung alle, einarbeitende und neue Person die eigene, andere keine.
  assert.equal((await onboardingOverview(mentor)).onboardings.length, 1);
  assert.equal((await onboardingOverview(newcomer)).onboardings[0].canSign, false);
  assert.equal((await onboardingOverview(other)).onboardings.length, 0);
  assert.deepEqual((await onboardingOverview(mentor)).staff, [], "Personalliste nur für die Leitung");

  const [first, second, third] = onboarding.steps;
  assert.equal((await failure(signOnboardingStep(newcomer, first.id, { done: true }))).status, 403);
  assert.equal((await failure(signOnboardingStep(other, first.id, { done: true }))).status, 403);
  await signOnboardingStep(mentor, first.id, { done: true, note: "gemeinsam" });
  assert.equal((await failure(signOnboardingStep(mentor, first.id, { done: true }))).status, 409);
  await signOnboardingStep(mentor, second.id, { done: true });
  assert.match((await failure(completeOnboarding(lead, id))).message, /Noch 1 Punkt offen/);
  await signOnboardingStep(lead, third.id, { done: true });
  await signOnboardingStep(mentor, second.id, { done: false });
  assert.equal((await failure(completeOnboarding(lead, id))).status, 409);
  await signOnboardingStep(mentor, second.id, { done: true });
  overview = await onboardingOverview(mentor);
  onboarding = overview.onboardings[0];
  assert.equal(onboarding.steps[0].done?.by, "Anna Müller");
  assert.equal(onboarding.steps[0].note, "gemeinsam");
  assert.equal(onboarding.steps[2].done?.by, "Laura Leitung");

  assert.equal((await failure(completeOnboarding(mentor, id))).status, 403);
  await completeOnboarding(lead, id);
  assert.equal((await failure(completeOnboarding(lead, id))).status, 409);
  assert.equal((await failure(signOnboardingStep(mentor, first.id, { done: false }))).status, 409);
  onboarding = (await onboardingOverview(lead)).onboardings[0];
  assert.equal(onboarding.completed?.by, "Laura Leitung");
  assert.equal(onboarding.canSign, false);

  // Nach dem Abschluss ist ein neuer Start möglich (z. B. Rollenwechsel).
  await startOnboarding(lead, start);

  // Fremde Einrichtung sieht nichts und kann nichts abzeichnen.
  const g = await fixture();
  const stranger = await apiContextFor(g, "leadA");
  assert.equal((await onboardingOverview(stranger)).onboardings.length, 0);
  assert.equal((await failure(signOnboardingStep(stranger, first.id, { done: false }))).status, 404);

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'onboarding' AND entity_id = $1 ORDER BY created_at`,
    [id],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["started", "step_signed", "step_signed", "step_signed", "step_reopened", "step_signed", "completed"],
  );
});
