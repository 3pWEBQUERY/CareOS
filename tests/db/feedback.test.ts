import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import {
  createFeedbackReminders,
  feedbackOverview,
  recordFeedback,
  saveFeedbackResponseDays,
  updateFeedback,
} from "@/lib/feedback";
import { apiContextFor, createResident, fixture, q } from "../support/db";

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  assert.fail("Fehler erwartet");
}

test("Rückmeldungen: Frist der Einrichtung, Zuständigkeit, Antwort, Abschluss, Auswertung, Erinnerung", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const qm = {
    ...lead,
    actor: { ...lead.actor, permissions: [...new Set([...lead.actor.permissions, "quality.manage"])] },
  } as ApiContext;
  const nurse = await apiContextFor(f, "anna");
  const max = await apiContextFor(f, "max");
  const reader = {
    ...nurse,
    actor: { ...nurse.actor, permissions: ["residents.read"] },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const base = {
    kind: "complaint",
    source: "relative",
    sourceName: "Frau Muster (Tochter)",
    contact: "079 000 00 00",
    channel: "phone",
    residentId: erna,
    topic: "Wäsche",
    description: "Pullover kam verfilzt zurück.",
  };

  // Keine Vorgabe: ohne Frist der Einrichtung keine Fälligkeit.
  assert.equal((await feedbackOverview(qm, null)).responseDays, null);
  assert.equal((await failure(saveFeedbackResponseDays(nurse, { days: 14 }))).status, 403);
  assert.equal(
    (await failure(saveFeedbackResponseDays(qm, { days: 0 }))).message,
    "Die Frist ist ungültig (1 bis 365 Tage).",
  );
  const { id: noDeadline } = await recordFeedback(nurse, { ...base, receivedOn: "2026-01-05" });
  await saveFeedbackResponseDays(qm, { days: 14 });
  assert.equal((await feedbackOverview(qm, "2026")).responseDays, 14);

  assert.equal((await failure(recordFeedback(reader, { ...base, receivedOn: "2026-01-05" }))).status, 403);
  assert.equal(
    (await failure(recordFeedback(nurse, { ...base, kind: "x", receivedOn: "2026-01-05" }))).message,
    "Bitte die Art wählen.",
  );
  assert.equal(
    (await failure(recordFeedback(nurse, { ...base, description: " ", receivedOn: "2026-01-05" }))).message,
    "Bitte die Rückmeldung beschreiben.",
  );
  assert.equal(
    (await failure(recordFeedback(nurse, { ...base, receivedOn: "2099-01-01" }))).message,
    "Das Eingangsdatum liegt in der Zukunft.",
  );
  assert.equal(
    (await failure(recordFeedback(nurse, { ...base, receivedOn: "2026-01-05", assignedTo: f.people.max }))).status,
    403,
    "Zuständigkeit legt das QM fest",
  );
  const { id: complaint } = await recordFeedback(qm, { ...base, receivedOn: "2026-01-10", assignedTo: f.people.max });
  const { id: praise } = await recordFeedback(nurse, {
    ...base,
    kind: "praise",
    source: "resident",
    channel: "in_person",
    topic: "Verpflegung",
    description: "Das Essen war hervorragend.",
    receivedOn: "2026-02-01",
  });

  let overview = await feedbackOverview(qm, "2026");
  const find = (id: string) => overview.items.find((item) => item.id === id)!;
  assert.equal(find(noDeadline).dueOn, null);
  assert.equal(find(complaint).dueOn, "2026-01-24", "Eingang + 14 Tage");
  assert.equal(find(complaint).overdue, true);
  assert.equal(find(praise).dueOn, null, "Lob ohne Frist");
  assert.equal(find(complaint).residentName, "Muster Erna");
  assert.deepEqual(overview.topics, ["Verpflegung", "Wäsche"]);

  // Hinweis an die zuständige Person; Sichtbarkeit.
  const assigned = await q<{ type: string }>(`SELECT type FROM carecore_notifications WHERE user_id = $1`, [
    f.people.max,
  ]);
  assert.deepEqual(
    assigned.map((row) => row.type),
    ["feedback_assigned"],
  );
  assert.deepEqual(
    (await feedbackOverview(max, "2026")).items.map((item) => item.id),
    [complaint],
  );
  assert.equal((await feedbackOverview(nurse, "2026")).items.length, 2, "Pflege sieht nur selbst erfasste");

  // Erinnerung bei abgelaufener Frist an die zuständige Person, einmal; ohne Zuständigkeit an das QM.
  await createFeedbackReminders(max);
  await createFeedbackReminders(max);
  await createFeedbackReminders(qm);
  const overdue = (user: string) =>
    q(`SELECT 1 FROM carecore_notifications WHERE user_id = $1 AND type = 'feedback_overdue'`, [user]);
  assert.equal((await overdue(f.people.max)).length, 1);
  assert.equal((await overdue(f.people.leadA)).length, 0, "Fristlose Rückmeldung ohne Zuständigkeit: kein Hinweis");

  // Bearbeiten: zuständige Person ja, andere nicht; Zuständigkeit nur QM.
  assert.equal((await failure(updateFeedback(nurse, complaint, { action: "update", topic: "x" }))).status, 403);
  await updateFeedback(max, complaint, {
    action: "update",
    topic: "Wäsche",
    measures: "Mit der Wäscherei besprochen",
    assignedTo: f.people.anna,
    inProgress: true,
  });
  overview = await feedbackOverview(qm, "2026");
  assert.equal(find(complaint).status, "in_progress");
  assert.equal(find(complaint).assignedTo, f.people.max, "Zuständigkeit nicht durch die zuständige Person änderbar");
  assert.equal(
    (await failure(updateFeedback(qm, complaint, { action: "close" }))).message,
    "Bitte zuerst die Antwort festhalten (bei Lob nicht nötig).",
  );
  assert.equal(
    (await failure(updateFeedback(max, complaint, { action: "answer", response: "x", answeredOn: "2026-01-01" })))
      .message,
    "Die Antwort liegt vor dem Eingang.",
  );
  await updateFeedback(max, complaint, {
    action: "answer",
    response: "Telefonisch entschuldigt, Ersatz angeboten.",
    answeredOn: "2026-01-20",
  });
  assert.equal((await failure(updateFeedback(max, complaint, { action: "close" }))).status, 403);
  await updateFeedback(qm, complaint, { action: "close" });
  await updateFeedback(qm, praise, { action: "close" });
  assert.equal((await failure(updateFeedback(qm, praise, { action: "close" }))).status, 409);
  await updateFeedback(qm, praise, { action: "reopen" });
  await updateFeedback(qm, praise, { action: "close" });

  overview = await feedbackOverview(qm, "2026");
  assert.equal(find(complaint).status, "closed");
  assert.equal(find(complaint).overdue, false);
  const evaluation = overview.evaluation;
  assert.equal(evaluation.total, 3);
  assert.deepEqual(evaluation.byKind, { complaint: 2, suggestion: 0, praise: 1 });
  assert.equal(evaluation.bySource.relative, 2);
  assert.deepEqual(evaluation.byTopic, [
    { topic: "Verpflegung", complaint: 0, suggestion: 0, praise: 1 },
    { topic: "Wäsche", complaint: 2, suggestion: 0, praise: 0 },
  ]);
  assert.equal(evaluation.byMonth[0], 2);
  assert.equal(evaluation.answered, 1);
  assert.equal(evaluation.withDeadline, 1);
  assert.equal(evaluation.answeredInTime, 1);
  assert.equal(evaluation.medianDays, 10);
  assert.equal((await feedbackOverview(qm, "2025")).evaluation.total, 0);

  // Fremde Einrichtung.
  const g = await fixture();
  const stranger = await apiContextFor(g, "leadA");
  const strangerQm = {
    ...stranger,
    actor: { ...stranger.actor, permissions: [...stranger.actor.permissions, "quality.manage"] },
  } as ApiContext;
  assert.equal((await feedbackOverview(strangerQm, "2026")).items.length, 0);
  assert.equal((await failure(updateFeedback(strangerQm, complaint, { action: "reopen" }))).status, 404);
  assert.equal(
    (await failure(recordFeedback(strangerQm, { ...base, receivedOn: "2026-01-05" }))).status,
    404,
    "Person einer anderen Einrichtung",
  );

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'feedback' AND entity_id = $1 ORDER BY created_at`,
    [complaint],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["recorded", "updated", "answered", "closed"],
  );
});
