import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { deleteWaitlistEntries, waitlistRetentionOverview } from "@/lib/retention";
import { saveSetting } from "@/lib/settings";
import { apiContextFor, createResident, fixture, q, type Fixture } from "../support/db";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

async function entry(f: Fixture, name: string, status: string, closedAgo: string, residentId: string | null = null) {
  const id = randomUUID();
  const [first, last] = name.split(" ");
  await q(
    `INSERT INTO carecore_waitlist_entries (id, organization_id, first_name, last_name, contact_phone, registered_on,
       status, status_note, resident_id, updated_at)
     VALUES ($1, $2, $3, $4, '079 000 00 00', CURRENT_DATE - 400, $5, $6, $7, NOW() - $8::interval)`,
    [id, f.org, first, last, status, status === "withdrawn" ? "anderes Heim" : "", residentId, closedAgo],
  );
  return id;
}

test("Warteliste: abgeschlossene Anfragen nach Ablauf der Frist löschen, nur auf Bestätigung der Administration", async () => {
  const f = await fixture();
  const other = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  };
  const entered = await createResident(f, "Ida Eingetreten");
  const planned = await createResident(f, "Paul Geplant");
  await q(`UPDATE carecore_residents SET status = 'planned' WHERE id = $1`, [planned]);

  const withdrawn = await entry(f, "Wanda Zurück", "withdrawn", "8 months");
  const admitted = await entry(f, "Ida Eingetreten", "admitted", "13 months", entered);
  const stillPlanned = await entry(f, "Paul Geplant", "admitted", "13 months", planned);
  const recent = await entry(f, "Rita Frisch", "withdrawn", "2 months");
  const waiting = await entry(f, "Otto Wartet", "waiting", "3 years");
  const foreign = await entry(other, "Fremd Haus", "withdrawn", "3 years");
  await q(
    `INSERT INTO carecore_audit_log (id, organization_id, entity_type, entity_id, action, after_data)
     VALUES ($1, $2, 'waitlist_entry', $3, 'status_withdrawn', '{"note":"anderes Heim"}')`,
    [randomUUID(), f.org, withdrawn],
  );

  assert.equal((await failure(waitlistRetentionOverview(lead))).status, 403);
  assert.deepEqual((await waitlistRetentionOverview(admin)).cases, [], "ohne Frist wird nichts vorgeschlagen");
  assert.equal((await failure(deleteWaitlistEntries(admin, [withdrawn]))).status, 409);

  await saveSetting(admin, "waitlistRetentionMonths", { enabled: true, value: 6 });
  const overview = await waitlistRetentionOverview(admin);
  assert.equal(overview.months, 6);
  // Nicht: frisch abgeschlossen, noch wartend, Eintritt noch geplant, andere Einrichtung.
  assert.deepEqual(
    overview.cases.map((item) => [item.name, item.status]),
    [
      ["Ida Eingetreten", "admitted"],
      ["Wanda Zurück", "withdrawn"],
    ],
  );

  for (const id of [recent, waiting, stillPlanned, foreign])
    assert.equal(
      (await failure(deleteWaitlistEntries(admin, [withdrawn, id]))).message,
      "Die Aufbewahrungsfrist ist nicht für alle gewählten Anfragen abgelaufen.",
    );
  assert.equal((await failure(deleteWaitlistEntries(admin, []))).status, 400);
  assert.equal((await failure(deleteWaitlistEntries(lead, [withdrawn]))).status, 403);

  assert.deepEqual(await deleteWaitlistEntries(admin, [withdrawn, admitted]), { deleted: 2 });
  const left = await q<{ id: string }>(`SELECT id FROM carecore_waitlist_entries WHERE id = ANY($1::uuid[])`, [
    [withdrawn, admitted, stillPlanned, recent, waiting, foreign],
  ]);
  assert.deepEqual(new Set(left.map((row) => row.id)), new Set([stillPlanned, recent, waiting, foreign]));
  // Akte der eingetretenen Person bleibt, Protokoll ohne Inhalte, Löschung ohne Namen protokolliert.
  assert.equal((await q(`SELECT 1 FROM carecore_residents WHERE id = $1`, [entered])).length, 1);
  const logged = await q<{ action: string; after_data: Record<string, unknown> | null }>(
    `SELECT action, after_data FROM carecore_audit_log WHERE entity_id = $1 ORDER BY created_at`,
    [withdrawn],
  );
  assert.deepEqual(logged[0], { action: "status_withdrawn", after_data: null });
  assert.equal(logged[1].action, "deleted");
  assert.equal(logged[1].after_data?.retentionMonths, 6);
  assert.ok(!JSON.stringify(logged[1].after_data).includes("Wanda"));
  assert.deepEqual((await waitlistRetentionOverview(admin)).cases, []);
});
