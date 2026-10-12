import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { organizationName, saveOrganizationName } from "@/lib/branding";
import { dismissSetupChecklist, setupChecklist } from "@/lib/setup-checklist";
import { apiContextFor, fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

async function setup() {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  };
  return { f, lead, admin };
}

const states = async (ctx: Parameters<typeof setupChecklist>[0]) =>
  Object.fromEntries((await setupChecklist(ctx)).steps.map((step) => [step.id, step.done]));

test("Ersteinrichtung: Schritte aus den Daten, Name der Einrichtung, ausblenden – nur Administration", async () => {
  const { f, lead, admin } = await setup();
  assert.equal(await status(setupChecklist(lead)), 403);

  // Fixture: eigener Name, zwei Wohnbereiche, mehrere Mitarbeitende; ohne Adresse, Bewohner, E-Mail, Zwei-Faktor.
  assert.deepEqual(await states(admin), {
    name: true,
    country: false,
    site: false,
    units: true,
    staff: true,
    residents: false,
    mail: false,
    security: false,
  });

  // Standardname einer frischen Installation gilt als offen.
  await q(`UPDATE carecore_organizations SET name = 'CareOS' WHERE id = $1`, [f.org]);
  assert.equal((await states(admin)).name, false);
  assert.equal(await status(saveOrganizationName(lead, "Heim")), 403);
  assert.equal(await status(saveOrganizationName(admin, "   ")), 400);
  assert.equal(await status(saveOrganizationName(admin, "x".repeat(181))), 400);
  assert.equal(await saveOrganizationName(admin, "  Alterszentrum   Sonnengarten "), "Alterszentrum Sonnengarten");
  assert.equal(await organizationName(admin), "Alterszentrum Sonnengarten");
  const [audit] = await q<{ before_data: { name: string }; after_data: { name: string } }>(
    `SELECT before_data, after_data FROM carecore_audit_log WHERE entity_id = $1 AND action = 'name_updated'`,
    [f.org],
  );
  assert.deepEqual([audit.before_data.name, audit.after_data.name], ["CareOS", "Alterszentrum Sonnengarten"]);
  assert.equal((await states(admin)).name, true);

  // Adresse am Standort.
  await q(`UPDATE carecore_sites SET address_line1 = 'Gartenweg 1', city = 'Bern' WHERE organization_id = $1`, [f.org]);
  assert.equal((await states(admin)).site, true);

  // Ausblenden gilt für die Einrichtung und lässt sich zurücknehmen.
  assert.equal((await dismissSetupChecklist(admin, true)).dismissed, true);
  assert.equal((await setupChecklist(admin)).dismissed, true);
  assert.equal((await dismissSetupChecklist(admin, false)).dismissed, false);
});
