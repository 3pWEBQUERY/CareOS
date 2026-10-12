import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { authenticateApiKey, createApiKey, listApiKeys, logApiAccess, revokeApiKey } from "@/lib/api-keys";
import {
  FhirError,
  observationResource,
  patientResource,
  readObservation,
  readPatient,
  searchObservations,
  searchPatients,
} from "@/lib/fhir";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError || error instanceof FhirError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

async function adminOf(f: Awaited<ReturnType<typeof fixture>>) {
  const lead = await apiContextFor(f, "leadA");
  return { ...lead, actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] } };
}

test("API-Schlüssel: nur Administration, nur Hash gespeichert, Berechtigung und Widerruf wirken, protokolliert", async () => {
  const f = await fixture();
  const admin = await adminOf(f);
  const anna = await apiContextFor(f, "anna");

  assert.equal((await failure(createApiKey(anna, { name: "X", scopes: ["system/Patient.read"] }))).status, 403);
  assert.equal((await failure(listApiKeys(anna))).status, 403);
  assert.equal((await failure(createApiKey(admin, { name: "", scopes: ["system/Patient.read"] }))).status, 400);
  assert.equal((await failure(createApiKey(admin, { name: "X", scopes: ["system/Everything"] }))).status, 400);

  const created = await createApiKey(admin, { name: "Hausarzt", scopes: ["system/Patient.read", "unbekannt"] });
  assert.match(created.key, /^cck_[A-Za-z0-9_-]{43}$/);
  const stored = await q(`SELECT key_hash, scopes FROM carecore_api_keys WHERE id = $1`, [created.id]);
  assert.notEqual(stored[0].key_hash, created.key, "nur der Hash liegt in der Datenbank");
  assert.deepEqual(stored[0].scopes, ["system/Patient.read"]);

  const [listed] = await listApiKeys(admin);
  assert.equal(listed.name, "Hausarzt");
  assert.equal(listed.prefix, created.key.slice(0, 12));
  assert.equal("key" in listed, false, "die Liste enthält den Schlüssel nicht");

  const client = await authenticateApiKey(admin.sql, `Bearer ${created.key}`, "system/Patient.read");
  assert.ok(!("status" in client));
  assert.equal(client.organizationId, f.org);
  const used = await q(`SELECT last_used_at FROM carecore_api_keys WHERE id = $1`, [created.id]);
  assert.ok(used[0].last_used_at, "letzte Nutzung wird vermerkt");

  const missingScope = await authenticateApiKey(admin.sql, `Bearer ${created.key}`, "system/Observation.read");
  assert.ok("status" in missingScope && missingScope.status === 403);
  const wrong = await authenticateApiKey(admin.sql, `Bearer cck_${"a".repeat(43)}`, "system/Patient.read");
  assert.ok("status" in wrong && wrong.status === 401);
  const none = await authenticateApiKey(admin.sql, null, "system/Patient.read");
  assert.ok("status" in none && none.status === 401);

  await logApiAccess(admin.sql, client, "Patient", "?active=true", 3);
  await revokeApiKey(admin, created.id);
  const revoked = await authenticateApiKey(admin.sql, `Bearer ${created.key}`, "system/Patient.read");
  assert.ok("status" in revoked && revoked.status === 401, "widerrufene Schlüssel gelten nicht mehr");
  assert.ok((await listApiKeys(admin))[0].revokedAt);

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'api_key' AND entity_id = $1 ORDER BY created_at`,
    [created.id],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["api_key_created", "api_read", "api_key_revoked"],
  );
});

test("FHIR: Patient und Observation nur der eigenen Einrichtung, Suche nach Person, Code und Zeitraum", async () => {
  const f = await fixture();
  const other = await fixture();
  const admin = await adminOf(f);
  const foreignAdmin = await adminOf(other);
  const erna = await createResident(f, "Erna Muster");
  const hans = await createResident(f, "Hans Beispiel");
  const foreign = await createResident(other, "Fritz Fremd");
  await q(
    `UPDATE carecore_residents SET external_number = 'B-17', date_of_birth = '1940-03-02', gender = 'female' WHERE id = $1`,
    [erna],
  );
  await q(`UPDATE carecore_residents SET status = 'discharged' WHERE id = $1`, [hans]);
  const measurement = async (
    resident: string,
    metric: string,
    value: number,
    unit: string,
    at: string,
    secondary: number | null = null,
  ) => {
    const id = randomUUID();
    await q(
      `INSERT INTO carecore_vital_measurements (id, resident_id, measured_at, metric, value, unit, secondary_value, status, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'attention', 'Freitext bleibt intern')`,
      [id, resident, at, metric, value, unit, secondary],
    );
    return id;
  };
  const bp = await measurement(erna, "Blutdruck", 150, "mmHg", "2026-03-01T07:00:00Z", 85);
  const pulse = await measurement(erna, "Puls", 88, "/min", "2026-03-02T07:00:00Z");
  await measurement(foreign, "Puls", 70, "/min", "2026-03-02T07:00:00Z");

  const key = (
    await createApiKey(admin, { name: "Auswertung", scopes: ["system/Patient.read", "system/Observation.read"] })
  ).key;
  const client = await authenticateApiKey(admin.sql, `Bearer ${key}`, "system/Patient.read");
  assert.ok(!("status" in client));
  const params = (value: string) => new URLSearchParams(value);

  const all = await searchPatients(admin.sql, client, params(""));
  assert.deepEqual(
    new Set(all.entries.map((row) => row.id)),
    new Set([erna, hans]),
    "keine Personen fremder Einrichtungen",
  );
  const active = await searchPatients(admin.sql, client, params("active=true"));
  assert.deepEqual(
    active.entries.map((row) => row.id),
    [erna],
  );
  const byNumber = await searchPatients(admin.sql, client, params("identifier=urn:carecore:resident-number|B-17"));
  assert.equal(byNumber.total, 1);
  const paged = await searchPatients(admin.sql, client, params("_count=1"));
  assert.equal(paged.entries.length, 1);
  assert.equal(paged.total, 2);
  assert.equal((await failure(searchPatients(admin.sql, client, params("name=Erna")))).status, 400);

  const patient = patientResource(await readPatient(admin.sql, client, erna));
  assert.equal(patient.resourceType, "Patient");
  assert.equal(patient.birthDate, "1940-03-02");
  assert.equal(patient.gender, "female");
  assert.deepEqual(patient.identifier, [{ system: "urn:carecore:resident-number", value: "B-17" }]);
  assert.equal((await failure(readPatient(admin.sql, client, foreign))).status, 404, "fremde Person nicht lesbar");

  const observations = await searchObservations(admin.sql, client, params(`patient=Patient/${erna}`));
  assert.deepEqual(
    observations.entries.map((row) => row.id),
    [pulse, bp],
    "neueste zuerst",
  );
  const byCode = await searchObservations(admin.sql, client, params("code=http://loinc.org|8867-4"));
  assert.deepEqual(
    byCode.entries.map((row) => row.id),
    [pulse],
    "nur eigene Einrichtung, nur Puls",
  );
  const byDate = await searchObservations(admin.sql, client, params("date=ge2026-03-01&date=le2026-03-01"));
  assert.deepEqual(
    byDate.entries.map((row) => row.id),
    [bp],
    "ganzer Tag, ohne den Folgetag",
  );
  const lab = await searchObservations(admin.sql, client, params("category=laboratory"));
  assert.equal(lab.total, 0);
  assert.equal((await failure(searchObservations(admin.sql, client, params("date=2026-03-01")))).status, 400);

  const blood = observationResource(await readObservation(admin.sql, client, bp)) as Record<string, unknown>;
  assert.deepEqual(blood.subject, { reference: `Patient/${erna}` });
  const components = blood.component as Array<{ valueQuantity: { value: number; code: string } }>;
  assert.deepEqual(
    components.map((component) => [component.valueQuantity.value, component.valueQuantity.code]),
    [
      [150, "mm[Hg]"],
      [85, "mm[Hg]"],
    ],
  );
  assert.equal(JSON.stringify(blood).includes("Freitext"), false, "Bemerkungen werden nicht ausgegeben");

  // Ein Schlüssel einer anderen Einrichtung sieht die Daten nicht.
  const foreignKey = (await createApiKey(foreignAdmin, { name: "Fremd", scopes: ["system/Observation.read"] })).key;
  const foreignClient = await authenticateApiKey(admin.sql, `Bearer ${foreignKey}`, "system/Observation.read");
  assert.ok(!("status" in foreignClient));
  assert.equal((await failure(readObservation(admin.sql, foreignClient, bp))).status, 404);
  const foreignSearch = await searchObservations(admin.sql, foreignClient, params(`patient=${erna}`));
  assert.equal(foreignSearch.total, 0);
});
