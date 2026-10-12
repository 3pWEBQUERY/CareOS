import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { EXPORT_EXCLUDED, EXPORT_SECTIONS, exportResidentData } from "@/lib/data-export";
import { EXPORT_COLUMN_LABELS, EXPORT_HIDDEN_COLUMNS } from "@/lib/data-export-shared";
import { fieldLabel } from "@/lib/audit-labels";
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

test("Auskunft: jede Tabelle mit Personenbezug ist erfasst oder begründet ausgenommen", async () => {
  const tables = await q<{ table_name: string }>(
    `SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'resident_id'`,
  );
  const covered = new Set([...EXPORT_SECTIONS.flatMap((section) => section.tables), ...Object.keys(EXPORT_EXCLUDED)]);
  assert.deepEqual(
    tables.map((row) => row.table_name).filter((name) => !covered.has(name)),
    [],
    "neue Tabelle mit resident_id in lib/data-export.ts aufnehmen",
  );
});

test("Auskunft: jede Spalte hat in der lesbaren Fassung eine deutsche Bezeichnung oder ist bewusst ausgeblendet", async () => {
  const tables = [...new Set(EXPORT_SECTIONS.flatMap((section) => section.tables))];
  const columns = await q<{ column_name: string }>(
    `SELECT DISTINCT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [tables],
  );
  assert.deepEqual(
    columns
      .map((row) => row.column_name)
      .filter((name) => !EXPORT_HIDDEN_COLUMNS.has(name) && !EXPORT_COLUMN_LABELS[name] && !fieldLabel(name)),
    [],
    "Bezeichnung in lib/data-export-shared.ts ergänzen",
  );
});

test("Auskunft: alle Daten einer Person, nur Administration, ohne fremde Personen, mit Protokoll", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const entry = async (resident: string, body: string) =>
    q(
      `INSERT INTO carecore_documentation_entries (id, resident_id, author_user_id, category, body) VALUES ($1, $2, $3, 'Pflege', $4)`,
      [randomUUID(), resident, f.people.anna, body],
    );
  await entry(erna, "Gut geschlafen");
  await entry(otto, "Fremder Eintrag");
  await q(
    `INSERT INTO carecore_vital_measurements (id, resident_id, metric, value, unit, measured_at) VALUES ($1, $2, 'weight', 61.5, 'kg', NOW())`,
    [randomUUID(), erna],
  );
  await q(`UPDATE carecore_residents SET photo_storage_key = 'geheim/foto.jpg' WHERE id = $1`, [erna]);

  assert.equal((await failure(exportResidentData(lead, erna, { requestedBy: "Erna Muster" }))).status, 403);
  assert.equal((await failure(exportResidentData(admin, erna, {}))).status, 400);
  const other = await fixture();
  assert.equal(
    (await failure(exportResidentData(admin, await createResident(other, "Fremd Haus"), { requestedBy: "X" }))).status,
    404,
  );

  const result = await exportResidentData(admin, erna, { requestedBy: "Petra Muster (Tochter)", format: "json" });
  assert.equal(result.format, "carecore-auskunft");
  assert.equal(result.resident.name, "Erna Muster");
  assert.equal(result.requestedBy, "Petra Muster (Tochter)");
  const section = (key: string) => result.sections.find((item) => item.key === key)!;
  assert.equal(section("resident").rows.length, 1);
  assert.equal(section("resident").rows[0].photo_storage_key, undefined, "keine Speicherpfade");
  assert.deepEqual(
    section("documentation").rows.map((row) => row.body),
    ["Gut geschlafen"],
  );
  assert.equal(section("vitals").rows.length, 1);
  assert.equal(section("stays").rows.length, 1);
  assert.equal(result.staff[f.people.anna], "Anna Müller", "Namen der Mitarbeitenden statt Kennungen");
  assert.ok(!JSON.stringify(result).includes("Fremder Eintrag"));

  const audit = await q<{ action: string; after: Record<string, unknown> }>(
    `SELECT action, after_data AS after FROM carecore_audit_log WHERE entity_id = $1 AND action = 'data_exported'`,
    [erna],
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].after.requestedBy, "Petra Muster (Tochter)");
  assert.equal(audit[0].after.format, "json");
  // Der Export selbst erscheint in der nächsten Auskunft im Änderungsprotokoll.
  const again = await exportResidentData(admin, erna, { requestedBy: "Erna Muster" });
  assert.ok(again.sections.find((item) => item.key === "audit")!.rows.some((row) => row.action === "data_exported"));
});
