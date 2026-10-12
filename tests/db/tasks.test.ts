import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { createTask, listTasks, setTaskStatus } from "@/lib/tasks";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

const taskRow = async (id: string) =>
  (
    await q<{ status: string; completion_note: string | null; follow_up_task_id: string | null }>(
      "SELECT status, completion_note, follow_up_task_id FROM carecore_tasks WHERE id = $1",
      [id],
    )
  )[0];

const docs = (residentId: string) =>
  q<{ body: string; importance: string }>(
    "SELECT body, importance FROM carecore_documentation_entries WHERE resident_id = $1 ORDER BY created_at",
    [residentId],
  );

test("Aufgaben: teilweise und nicht erledigt brauchen eine Begründung und landen in der Dokumentation", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const partialId = await createTask(ctx, { title: "Grundpflege", residentId, category: "Pflege" });
  const skippedId = await createTask(ctx, {
    title: "Mobilisation",
    residentId,
    category: "Pflege",
    recurrence: "daily",
    dueAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  assert.equal(await status(setTaskStatus(ctx, partialId, { status: "partial" })), 400);
  assert.equal(await status(setTaskStatus(ctx, skippedId, { status: "skipped", note: " " })), 400);
  assert.equal(await status(setTaskStatus(ctx, partialId, { status: "erledigt?" })), 400);

  await setTaskStatus(ctx, partialId, { status: "partial", note: "Haarwäsche abgelehnt" });
  await setTaskStatus(ctx, skippedId, { status: "skipped", note: "Bewohnerin schläft" });
  assert.equal((await taskRow(partialId)).status, "partial");
  const skipped = await taskRow(skippedId);
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.completion_note, "Bewohnerin schläft");
  // Wiederkehrende Aufgaben gehen auch nach „nicht erledigt“ weiter.
  assert.ok(skipped.follow_up_task_id);

  const entries = await docs(residentId);
  assert.deepEqual(
    entries.map((entry) => entry.body),
    ["Grundpflege (teilweise): Haarwäsche abgelehnt", "Mobilisation (nicht erledigt): Bewohnerin schläft"],
  );
  assert.ok(entries.every((entry) => entry.importance === "important"));

  // Abgeschlossen: kein zweiter Abschluss, kein Abbruch; wieder öffnen geht.
  assert.equal(await status(setTaskStatus(ctx, partialId, { status: "completed" })), 409);
  assert.equal(await status(setTaskStatus(ctx, partialId, { status: "cancelled", reason: "x" })), 409);
  await setTaskStatus(ctx, partialId, { status: "open" });
  const reopened = await taskRow(partialId);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.completion_note, null);
});

test("Aufgaben: Eskalation bleibt offen und benachrichtigt die Leitung", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const taskId = await createTask(ctx, { title: "Verbandwechsel", residentId, category: "Wundmanagement" });

  assert.equal(await status(setTaskStatus(ctx, taskId, { status: "escalated" })), 400);
  await setTaskStatus(ctx, taskId, { status: "escalated", reason: "Material fehlt" });

  const [task] = (await listTasks(ctx, new URLSearchParams("scope=team"))).tasks.filter((item) => item.id === taskId);
  assert.equal(task.status, "escalated");
  assert.equal(task.escalationReason, "Material fehlt");
  assert.equal(task.escalatedByName, "Anna Müller");

  // Nur die Leitung (team.manage) erhält die Meldung, nicht die eskalierende Person oder andere Pflegende.
  const notified = await q<{ user_id: string; priority: string; link_url: string }>(
    "SELECT user_id, priority, link_url FROM carecore_notifications WHERE type = 'task_escalated' AND entity_id = $1",
    [taskId],
  );
  assert.deepEqual(notified.map((row) => row.user_id).sort(), [f.people.leadA, f.people.leadB].sort());
  assert.ok(notified.every((row) => row.priority === "high" && row.link_url.endsWith(`task=${taskId}`)));
  assert.equal(await status(setTaskStatus(ctx, taskId, { status: "escalated", reason: "nochmals" })), 200);

  // Eskaliert heisst weiterhin offen: abschliessen geht, Grund der Eskalation bleibt erhalten.
  await setTaskStatus(ctx, taskId, { status: "completed" });
  const [row] = await q<{ status: string; escalation_reason: string }>(
    "SELECT status, escalation_reason FROM carecore_tasks WHERE id = $1",
    [taskId],
  );
  assert.equal(row.status, "completed");
  assert.equal(row.escalation_reason, "Material fehlt");
  const [audit] = await q<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM carecore_audit_log WHERE entity_id = $1 AND action = 'escalated'",
    [taskId],
  );
  assert.equal(audit.n, 1);
});
