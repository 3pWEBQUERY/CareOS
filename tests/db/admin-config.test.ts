import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { logoUpdatedAt, readLogo, removeLogo, saveLogo } from "@/lib/branding";
import { readHiddenVitals, saveHiddenVitals } from "@/lib/settings";
import { recordMeasurements, vitalsOverview } from "@/lib/vitals";
import { apiContextFor, createResident, fixture } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

test("Vitalparameter: Einrichtung blendet Blutzucker aus – keine neue Messung, Übersicht ohne alten Wert", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const anna = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  await recordMeasurements(anna, { residentId, values: { Blutzucker: { value: 25 } } });
  const before = (await vitalsOverview(anna)).residents.find((resident) => resident.id === residentId)!;
  assert.equal(before.latest.Blutzucker?.status, "critical");

  assert.equal(await status(saveHiddenVitals(lead, { hidden: ["Unbekannt"] })), 400);
  assert.equal(
    await status(
      saveHiddenVitals(lead, {
        hidden: ["Blutdruck", "Puls", "Temperatur", "Sauerstoffsättigung", "Blutzucker", "Gewicht"],
      }),
    ),
    400,
    "mindestens ein Vitalparameter bleibt",
  );
  assert.deepEqual(await saveHiddenVitals(lead, { hidden: ["Blutzucker"] }), ["Blutzucker"]);
  assert.deepEqual(await readHiddenVitals(lead), ["Blutzucker"]);

  assert.equal(await status(recordMeasurements(anna, { residentId, values: { Blutzucker: { value: 6 } } })), 400);
  await recordMeasurements(anna, { residentId, values: { Puls: { value: 72 } } });
  const after = (await vitalsOverview(anna)).residents.find((resident) => resident.id === residentId)!;
  assert.equal(after.latest.Blutzucker, undefined);
  assert.equal(after.status, "normal", "ausgeblendeter kritischer Wert zählt nicht");
});

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test("Branding: Logo nur durch die Administration, nur echte Bilder bis 2 MB, entfernen", async () => {
  const f = await fixture();
  const anna = await apiContextFor(f, "anna");
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  };
  assert.equal(await status(saveLogo(anna, `data:image/png;base64,${PNG_1X1}`)), 403);
  assert.equal(await status(saveLogo(admin, "data:image/svg+xml;base64,PHN2Zy8+")), 400, "kein SVG");
  const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
  assert.equal(await status(saveLogo(admin, `data:image/png;base64,${html}`)), 400, "Inhalt muss zum Typ passen");
  const big = Buffer.concat([Buffer.from(PNG_1X1, "base64"), Buffer.alloc(2 * 1024 * 1024)]).toString("base64");
  assert.equal(await status(saveLogo(admin, `data:image/png;base64,${big}`)), 413);
  const large = Buffer.concat([Buffer.from(PNG_1X1, "base64"), Buffer.alloc(1024 * 1024)]).toString("base64");
  assert.equal(await status(saveLogo(admin, `data:image/png;base64,${large}`)), 200, "1 MB ist erlaubt");
  await removeLogo(admin);

  assert.equal(await logoUpdatedAt(admin), null);
  const updatedAt = await saveLogo(admin, `data:image/png;base64,${PNG_1X1}`);
  assert.equal(await logoUpdatedAt(anna), updatedAt, "alle sehen das Logo der Einrichtung");
  const logo = await readLogo(anna);
  assert.equal(logo?.mimeType, "image/png");
  assert.equal(logo?.bytes.toString("base64"), PNG_1X1);
  await removeLogo(admin);
  assert.equal(await readLogo(anna), null);
});
