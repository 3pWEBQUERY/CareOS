import { test } from "node:test";
import assert from "node:assert/strict";
import { dateBounds, observationResource, patientResource, searchBundle } from "../lib/fhir.ts";

test("FHIR: Zeitraum-Grenzen – Tag ohne Uhrzeit umfasst den ganzen Tag, engste Grenze gilt", () => {
  assert.deepEqual(dateBounds(["ge2026-03-01", "le2026-03-01"]), {
    lower: { at: "2026-03-01T00:00:00.000Z", inclusive: true },
    upper: { at: "2026-03-02T00:00:00.000Z", inclusive: false },
  });
  assert.deepEqual(dateBounds(["gt2026-03-01T08:00:00+01:00"]).lower, {
    at: "2026-03-01T07:00:00.000Z",
    inclusive: false,
  });
  assert.equal(dateBounds(["ge2026-01-01", "ge2026-02-01"]).lower?.at, "2026-02-01T00:00:00.000Z");
  assert.throws(() => dateBounds(["eq2026-01-01"]));
  assert.throws(() => dateBounds(["ge2026-13-45"]));
});

test("FHIR: Person und Messung als Ressourcen, Suchergebnis mit Blättern", () => {
  const patient = patientResource({
    id: "p1",
    first_name: "Erna",
    last_name: "Muster",
    preferred_name: null,
    gender: "diverse",
    status: "deceased",
    deceased_on: null,
    language: "de-CH",
    updated_at: new Date("2026-01-01T00:00:00Z"),
  });
  assert.equal(patient.gender, "other");
  assert.equal(patient.active, false);
  assert.equal((patient as Record<string, unknown>).deceasedBoolean, true);

  const observation = observationResource({
    id: "o1",
    resident_id: "p1",
    metric: "Temperatur",
    value: "37.8",
    unit: "°C",
    status: "critical",
    measured_at: new Date("2026-01-01T07:00:00Z"),
    created_at: new Date("2026-01-01T07:01:00Z"),
  }) as Record<string, unknown>;
  assert.deepEqual(observation.valueQuantity, {
    value: 37.8,
    unit: "°C",
    system: "http://unitsofmeasure.org",
    code: "Cel",
  });
  assert.equal((observation.code as { coding: Array<{ code: string }> }).coding[0].code, "8310-5");
  assert.equal((observation.interpretation as Array<{ coding: Array<{ code: string }> }>)[0].coding[0].code, "AA");

  const bundle = searchBundle(
    "https://x/api/fhir/r4",
    "Patient",
    new URLSearchParams("active=true"),
    { total: 5, entries: [{ id: "p1" }], count: 2, offset: 2 },
    (row) => ({ id: row.id }),
  );
  assert.deepEqual(
    bundle.link.map((link) => [link.relation, link.url]),
    [
      ["self", "https://x/api/fhir/r4/Patient?active=true&_count=2&_offset=2"],
      ["next", "https://x/api/fhir/r4/Patient?active=true&_count=2&_offset=4"],
      ["previous", "https://x/api/fhir/r4/Patient?active=true&_count=2&_offset=0"],
    ],
  );
  assert.equal(bundle.entry[0].fullUrl, "https://x/api/fhir/r4/Patient/p1");
});
