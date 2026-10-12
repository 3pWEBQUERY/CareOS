import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { deleteResidentRecord, retentionOverview } from "@/lib/retention";
import { saveSetting } from "@/lib/settings";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

test("Aufbewahrung: nur nach Ablauf der Frist, nur mit Namen, löscht Akte samt verknüpften Daten", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  };
  const anna = await apiContextFor(f, "anna");
  const gone = await createResident(f, "Greta Alt");
  const kept = await createResident(f, "Hans Aktiv");
  await q(
    `UPDATE carecore_residents SET status = 'discharged', discharged_on = CURRENT_DATE - INTERVAL '3 years' WHERE id = $1`,
    [gone],
  );

  // Verknüpfte Daten der Person
  const fileId = randomUUID();
  await q(
    `INSERT INTO carecore_documentation_entries (id, resident_id, category, body) VALUES ($1, $2, 'Pflege', 'Gut geschlafen')`,
    [randomUUID(), gone],
  );
  await q(
    `INSERT INTO carecore_tasks (id, organization_id, resident_id, title) VALUES ($1, $2, $3, 'Arztbericht anfordern')`,
    [randomUUID(), f.org, gone],
  );
  await q(
    `INSERT INTO carecore_cloud_files (id, organization_id, name, size_bytes, content_base64) VALUES ($1, $2, 'bericht.pdf', 4, 'JVBERg==')`,
    [fileId, f.org],
  );
  await q(
    `INSERT INTO carecore_documents (id, organization_id, resident_id, title, file_id) VALUES ($1, $2, $3, 'Arztbericht', $4)`,
    [randomUUID(), f.org, gone, fileId],
  );
  const eventId = randomUUID();
  await q(
    `INSERT INTO carecore_quality_events (id, organization_id, resident_id, type, occurred_at, description) VALUES ($1, $2, $3, 'Sturz', NOW() - INTERVAL '3 years', 'Greta Alt gestürzt')`,
    [eventId, f.org, gone],
  );
  await q(
    `INSERT INTO carecore_notifications (id, user_id, title, body, type, link_url) VALUES ($1, $2, 'Hinweis', 'Greta Alt: Arztbericht', 'task_due', NULL)`,
    [randomUUID(), f.people.anna],
  );
  await q(
    `INSERT INTO carecore_audit_log (id, organization_id, entity_type, entity_id, action, after_data) VALUES ($1, $2, 'resident', $3, 'updated', '{"name":"Greta Alt"}')`,
    [randomUUID(), f.org, gone],
  );

  assert.equal((await failure(retentionOverview(anna))).status, 403);
  assert.deepEqual((await retentionOverview(admin)).cases, [], "ohne festgelegte Frist wird nichts vorgeschlagen");
  assert.equal((await failure(deleteResidentRecord(admin, gone, "Greta Alt"))).status, 409);

  await saveSetting(admin, "residentRetentionYears", { enabled: true, value: 5 });
  assert.deepEqual((await retentionOverview(admin)).cases, [], "Frist noch nicht abgelaufen");
  await saveSetting(admin, "residentRetentionYears", { enabled: true, value: 2 });
  const overview = await retentionOverview(admin);
  assert.deepEqual(
    overview.cases.map((item) => item.name),
    ["Greta Alt"],
    "aktive Personen nie",
  );
  assert.equal((await failure(deleteResidentRecord(anna, gone, "Greta Alt"))).status, 403);
  assert.equal((await failure(deleteResidentRecord(admin, gone, "Greta"))).status, 400);
  assert.equal((await failure(deleteResidentRecord(admin, kept, "Hans Aktiv"))).status, 409);

  await deleteResidentRecord(admin, gone, " Greta Alt ");
  const count = async (sql: string) => Number((await q<{ n: number }>(sql, [gone]))[0].n);
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM carecore_residents WHERE id = $1`), 0);
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM carecore_documentation_entries WHERE resident_id = $1`), 0);
  assert.equal(
    (await q(`SELECT 1 FROM carecore_tasks WHERE organization_id = $1 AND title = 'Arztbericht anfordern'`, [f.org]))
      .length,
    0,
    "Aufgaben zur Person gelöscht",
  );
  assert.equal((await q(`SELECT 1 FROM carecore_cloud_files WHERE id = $1`, [fileId])).length, 0, "Datei gelöscht");
  assert.equal((await q(`SELECT 1 FROM carecore_notifications WHERE body LIKE '%Greta Alt%'`)).length, 0);
  const [event] = await q<{ resident_id: string | null; description: string }>(
    `SELECT resident_id, description FROM carecore_quality_events WHERE id = $1`,
    [eventId],
  );
  assert.deepEqual(event, { resident_id: null, description: "Gelöscht nach Ablauf der Aufbewahrungsfrist." });
  assert.equal(
    (await q(`SELECT 1 FROM carecore_audit_log WHERE entity_id = $1 AND after_data::text LIKE '%Greta%'`, [gone]))
      .length,
    0,
  );
  assert.equal(
    (await q(`SELECT 1 FROM carecore_audit_log WHERE entity_type = 'resident_retention' AND entity_id = $1`, [gone]))
      .length,
    1,
  );
  assert.equal((await q(`SELECT 1 FROM carecore_residents WHERE id = $1`, [kept])).length, 1, "andere Akten bleiben");
});
