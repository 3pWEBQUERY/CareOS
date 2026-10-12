import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { countrySettings, saveOrganizationCountry } from "@/lib/organization-country";
import { createPlan } from "@/lib/care-planning";
import { updateMasterData } from "@/lib/resident-record";
import { saveHolidays } from "@/lib/roster/settings-service";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : ((error as { status?: number }).status ?? 500)),
  );

test("Land der Einrichtung: nur Administration, ergänzt Qualifikationen, protokolliert", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  };

  assert.deepEqual(await countrySettings(admin), { country: "CH", region: null, confirmed: false });
  assert.equal(await status(saveOrganizationCountry(lead, "DE")), 403);
  assert.equal(await status(saveOrganizationCountry(admin, "FR")), 400);

  await q(
    `INSERT INTO carecore_qualifications (organization_id, code, name) VALUES ($1, 'HF', 'Pflegefachperson HF')
    ON CONFLICT DO NOTHING`,
    [f.org],
  );
  assert.equal(await status(saveOrganizationCountry(admin, "DE", "ZH")), 400, "Kanton passt nicht zu Deutschland");
  assert.deepEqual(await saveOrganizationCountry(admin, "DE", "BY"), { country: "DE", region: "BY", confirmed: true });
  assert.deepEqual(await countrySettings(admin), { country: "DE", region: "BY", confirmed: true });
  const codes = (
    await q<{ code: string; grants_medication: boolean }>(
      `SELECT code, grants_medication FROM carecore_qualifications WHERE organization_id = $1 ORDER BY code`,
      [f.org],
    )
  ).map((row) => `${row.code}:${row.grants_medication}`);
  // Deutsche Qualifikationen ergänzt, die bestehende bleibt.
  for (const expected of ["PFK:true", "AP:true", "GKP:true", "PH:false", "BK:false"])
    assert.ok(codes.includes(expected));
  assert.ok(codes.some((code) => code.startsWith("HF:")));
  const [audit] = await q<{ before_data: { country: string }; after_data: { country: string } }>(
    `SELECT before_data, after_data FROM carecore_audit_log WHERE entity_id = $1 AND action = 'country_updated'`,
    [f.org],
  );
  assert.deepEqual([audit.before_data.country, audit.after_data.country], ["CH", "DE"]);
  assert.equal((audit.after_data as { region?: string }).region, "BY");
});

test("Stammdaten prüfen die Sozialversicherungsnummer im Format des Landes", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const base = { firstName: "Erna", lastName: "Muster", gender: "female", language: "de-CH" };

  await updateMasterData(ctx, residentId, { ...base, socialSecurityNumber: "756.1234.5678.97" });
  await q(`UPDATE carecore_organizations SET country = 'AT' WHERE id = $1`, [f.org]);
  // Der gespeicherte Schweizer Wert bleibt beim Speichern anderer Felder gültig.
  assert.equal(
    await status(
      updateMasterData(ctx, residentId, {
        ...base,
        religion: "Konfessionslos",
        socialSecurityNumber: "756.1234.5678.97",
      }),
    ),
    200,
  );
  assert.equal(await status(updateMasterData(ctx, residentId, { ...base, socialSecurityNumber: "1234 010180" })), 400);
  assert.equal(await status(updateMasterData(ctx, residentId, { ...base, socialSecurityNumber: "1237 010180" })), 200);

  await q(`UPDATE carecore_organizations SET country = 'DE' WHERE id = $1`, [f.org]);
  assert.equal(await status(updateMasterData(ctx, residentId, { ...base, insuranceNumber: "12345" })), 400);
  assert.equal(await status(updateMasterData(ctx, residentId, { ...base, insuranceNumber: "A123456789" })), 200);
});

test("Feiertage übernehmen nach Land und Kanton bzw. Bundesland der Einrichtung", async () => {
  const f = await fixture();
  await q(`UPDATE carecore_organizations SET country = 'AT' WHERE id = $1`, [f.org]);
  const ctx = await f.ctx("leadA");
  assert.deepEqual(await saveHolidays(ctx, { action: "importHolidays", year: 2026 }), { saved: 13 });
  const names = (
    await q<{ name: string }>(`SELECT name FROM carecore_public_holidays WHERE organization_id = $1`, [f.org])
  ).map((row) => row.name);
  assert.ok(names.includes("Nationalfeiertag"));
  assert.ok(!names.includes("Bundesfeiertag"));

  // Bayern: zusätzlich Heilige Drei Könige, Fronleichnam und Allerheiligen (bundesweit 9, Bayern 12).
  await q(`UPDATE carecore_organizations SET country = 'DE', region = 'BY' WHERE id = $1`, [f.org]);
  assert.deepEqual(await saveHolidays(ctx, { action: "importHolidays", year: 2027 }), { saved: 12 });
  const bavaria = await q<{ name: string }>(
    `SELECT name FROM carecore_public_holidays WHERE organization_id = $1 AND date = '2027-11-01'`,
    [f.org],
  );
  assert.equal(bavaria[0]?.name, "Allerheiligen");
});

test("Pflegeplan nimmt nur die Einstufung des Landes an", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const plan = { residentId, focus: "Mobilität erhalten", startsOn: "2026-01-01", reviewOn: "2026-04-01" };
  await q(`UPDATE carecore_organizations SET country = 'DE' WHERE id = $1`, [f.org]);
  assert.equal(await status(createPlan(ctx, { ...plan, careLevel: "Pflegestufe 4" })), 400);
  assert.equal(await status(createPlan(ctx, { ...plan, careLevel: "Pflegegrad 3" })), 200);
});
