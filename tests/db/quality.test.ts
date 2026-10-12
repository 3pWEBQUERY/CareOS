import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { actionsData, createAction, eventsData, reportEvent, updateAction, updateEvent } from "@/lib/quality";
import { readEventTypes, saveEventTypes } from "@/lib/quality-types";
import { listWorkflows, saveWorkflow } from "@/lib/quality-workflows";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

const manager = (ctx: ApiContext): ApiContext => ({
  ...ctx,
  actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, "quality.manage"] },
});

test("Qualitätsmassnahme bearbeiten speichert die Änderungen (nicht nur den Status)", async () => {
  const f = await fixture();
  const lead = manager(await apiContextFor(f, "leadA"));
  const actionId = await createAction(lead, { title: "Doppelkontrolle", dueOn: "2030-01-15", ownerId: f.people.anna });
  await updateAction(lead, actionId, {
    title: "Doppelkontrolle Hochrisiko",
    description: "Insulin und Opioide",
    dueOn: "2030-02-01",
    ownerId: f.people.max,
    status: "planned",
  });
  const [row] = await q<{ title: string; description: string; owner_user_id: string; due: string; status: string }>(
    `SELECT title, description, owner_user_id, to_char(due_on, 'YYYY-MM-DD') AS due, status FROM carecore_quality_actions WHERE id = $1`,
    [actionId],
  );
  assert.deepEqual(row, {
    title: "Doppelkontrolle Hochrisiko",
    description: "Insulin und Opioide",
    owner_user_id: f.people.max,
    due: "2030-02-01",
    status: "planned",
  });
  // Neue verantwortliche Person wird benachrichtigt.
  const [notified] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE user_id = $1 AND type = 'quality_action'`,
    [f.people.max],
  );
  assert.equal(notified.n, 1);

  assert.match((await failure(updateAction(lead, actionId, { status: "done", note: "ok" }))).message, /Wirksamkeit/);
  await updateAction(lead, actionId, { status: "done", effectiveness: "effective", note: "Keine Fehler mehr" });
  assert.equal((await failure(updateAction(lead, actionId, { status: "open" }))).status, 409);
  assert.equal((await failure(updateAction(lead, actionId, { title: "x", dueOn: "2030-01-01" }))).status, 409);
  assert.equal((await actionsData(lead)).stats.doneThisYear >= 0, true);
});

test("Qualitätsereignis: Meldung benachrichtigt die Verantwortlichen, Abschluss mit Ergebnis, fremde Organisation 404", async () => {
  const f = await fixture();
  const reporter = await apiContextFor(f, "anna");
  const lead = manager(await apiContextFor(f, "leadA"));
  const residentId = await createResident(f);
  // Die Leitung hat quality.manage (Grunddaten) und wird benachrichtigt.
  const eventId = await reportEvent(reporter, {
    type: "Sturz",
    severity: "critical",
    description: "Im Zimmer gestürzt",
    occurredAt: new Date().toISOString(),
    residentId,
  });
  const notified = await q<{ user_id: string; priority: string }>(
    `SELECT user_id, priority FROM carecore_notifications WHERE type = 'quality_event' AND user_id = ANY($1::uuid[])`,
    [[f.people.leadA, f.people.leadB]],
  );
  assert.equal(notified.length, 2);
  assert.ok(notified.every((row) => row.priority === "high"));
  assert.equal((await failure(updateEvent(reporter, eventId, { status: "investigating" }))).status, 403);
  assert.match((await failure(updateEvent(lead, eventId, { status: "resolved" }))).message, /Ergebnis/);
  await updateEvent(lead, eventId, { status: "closed", resolution: "Sensormatte eingesetzt" });
  assert.equal((await failure(updateEvent(lead, eventId, { severity: "info" }))).status, 409);
  const other = manager(await apiContextFor(await fixture(), "leadA"));
  assert.equal((await failure(updateEvent(other, eventId, { status: "open" }))).status, 404);
  assert.match(
    (
      await failure(
        reportEvent(reporter, {
          type: "Sturz",
          severity: "info",
          description: "x",
          occurredAt: "2999-01-01T00:00:00Z",
        }),
      )
    ).message,
    /Zukunft/,
  );
});

test("Ablaufkette Sturz: Folgeaufgaben nach den Schritten der Einrichtung, verknüpft mit dem Ereignis", async () => {
  const f = await fixture();
  const lead = manager(await apiContextFor(f, "leadA"));
  const anna = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const step = { title: "Vitalzeichen kontrollieren", category: "Vitalwerte", priority: "high" };

  // Ohne festgelegte Fälligkeit oder Kategorie keine Ablaufkette; nur das Qualitätsmanagement legt sie fest.
  assert.equal((await failure(saveWorkflow(lead, "Sturz", [step]))).status, 400);
  assert.equal(
    (await failure(saveWorkflow(lead, "Sturz", [{ ...step, category: "", dueOffsetMinutes: 60 }]))).status,
    400,
  );
  assert.equal((await failure(saveWorkflow(anna, "Sturz", [{ ...step, dueOffsetMinutes: 60 }]))).status, 403);
  assert.equal((await failure(saveWorkflow(lead, "Unbekannt", []))).status, 400);

  await saveWorkflow(lead, "Sturz", [
    { ...step, dueOffsetMinutes: 60 },
    {
      title: "Sturzprotokoll ergänzen",
      description: "Hergang und Folgen",
      category: "Dokumentation",
      priority: "normal",
      dueOffsetMinutes: 1440,
      documentOnCompletion: true,
    },
  ]);
  assert.equal((await listWorkflows(anna)).Sturz.length, 2);

  const occurredAt = new Date(Date.now() - 30 * 60_000).toISOString();
  const eventId = await reportEvent(anna, {
    type: "Sturz",
    severity: "attention",
    description: "Neben dem Bett gefunden",
    occurredAt,
    residentId,
  });
  const tasks = await q<{
    title: string;
    resident_id: string;
    due: string;
    priority: string;
    document_on_completion: boolean;
    description: string;
    team_visible: boolean;
    id: string;
  }>(
    `SELECT id, title, resident_id, due_at AS due, priority, document_on_completion, description, team_visible
     FROM carecore_tasks WHERE quality_event_id = $1 ORDER BY due_at`,
    [eventId],
  );
  assert.deepEqual(
    tasks.map((t) => [t.title, t.priority, t.document_on_completion, t.team_visible, t.resident_id]),
    [
      ["Vitalzeichen kontrollieren", "high", false, true, residentId],
      ["Sturzprotokoll ergänzen", "normal", true, true, residentId],
    ],
  );
  assert.equal(new Date(tasks[0].due).getTime(), Date.parse(occurredAt) + 60 * 60_000);
  assert.match(tasks[1].description, /Hergang und Folgen\n\nFolge von Ereignis: Sturz/);

  await q(`UPDATE carecore_tasks SET status = 'completed' WHERE id = $1`, [tasks[0].id]);
  const event = (await eventsData(lead)).events.find((e) => e.id === eventId)!;
  assert.deepEqual([event.followUps, event.followUpsDone], [2, 1]);
  assert.deepEqual((await eventsData(lead)).workflowSteps, { Sturz: 2 });

  // Andere Ereignisarten ohne Ablaufkette erzeugen keine Aufgaben; eine leere Liste entfernt die Kette.
  const other = await reportEvent(anna, {
    type: "Beschwerde",
    severity: "info",
    description: "Essen kalt",
    occurredAt,
  });
  assert.equal((await q(`SELECT 1 FROM carecore_tasks WHERE quality_event_id = $1`, [other])).length, 0);
  await saveWorkflow(lead, "Sturz", []);
  assert.deepEqual((await eventsData(lead)).workflowSteps, {});
});

test("Eigene Ereignisarten: festlegen, melden, Ablaufkette, Entfernen nimmt die Ablaufkette mit", async () => {
  const f = await fixture();
  const lead = manager(await apiContextFor(f, "leadA"));
  const anna = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  assert.equal((await failure(saveEventTypes(anna, ["Weglaufen"]))).status, 403);
  assert.match((await failure(saveEventTypes(lead, ["sturz"]))).message, /gibt es bereits/);
  assert.match((await failure(saveEventTypes(lead, ["Weglaufen", "weglaufen"]))).message, /gibt es bereits/);
  assert.equal((await failure(saveEventTypes(lead, ["ab"]))).status, 400);
  assert.equal(
    (
      await failure(
        reportEvent(anna, {
          type: "Weglaufen",
          severity: "attention",
          description: "x",
          occurredAt: new Date().toISOString(),
          residentId,
        }),
      )
    ).status,
    400,
  );

  assert.deepEqual(await saveEventTypes(lead, ["Weglaufen"]), ["Weglaufen"]);
  assert.deepEqual((await readEventTypes(lead)).custom, ["Weglaufen"]);
  await saveWorkflow(lead, "Weglaufen", [
    { title: "Angehörige informieren", category: "Organisation", priority: "high", dueOffsetMinutes: 60 },
  ]);
  const eventId = await reportEvent(anna, {
    type: "Weglaufen",
    severity: "attention",
    description: "Im Garten gefunden",
    occurredAt: new Date().toISOString(),
    residentId,
  });
  assert.equal((await eventsData(lead)).events.find((event) => event.id === eventId)?.followUps, 1);
  assert.deepEqual((await eventsData(lead)).eventTypes.custom, ["Weglaufen"]);

  await saveEventTypes(lead, []);
  assert.deepEqual(await listWorkflows(lead), {}, "Ablaufkette der entfernten Art entfällt");
  assert.equal((await eventsData(lead)).events.find((event) => event.id === eventId)?.type, "Weglaufen");
});
