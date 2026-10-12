import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { qualityIndicators } from "@/lib/quality-indicators";
import { apiContextFor, createResident, fixture, q } from "../support/db";

test("Qualitätsindikatoren: alle sechs MQI aus den Daten, mit gezählten Personen und Wohnbereich", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");

  // Mangelernährung: 70 kg vor 40 Tagen, heute 66 kg (−5,7 %). Otto ohne Vergleichsgewicht.
  await q(
    `INSERT INTO carecore_vital_measurements (id, resident_id, measured_at, metric, value, unit) VALUES
       ($1, $3, NOW() - INTERVAL '40 days', 'Gewicht', 70, 'kg'), ($2, $3, NOW(), 'Gewicht', 66, 'kg'),
       ($4, $5, NOW(), 'Gewicht', 80, 'kg')`,
    [randomUUID(), randomUUID(), erna, randomUUID(), otto],
  );

  // Bettseitenteile seit 10 Tagen (zählt), Gurt seit 3 Tagen (noch nicht 7 Tage).
  const measure = (resident: string, kind: string, days: number) =>
    q(
      `INSERT INTO carecore_restraint_measures (id, organization_id, resident_id, kind, reason, alternatives, ordered_by,
         resident_consent, starts_at, review_on)
       VALUES ($1, $2, $3, $4, 'Sturzgefahr', 'Niederflurbett geprüft', 'PDL', 'incapable', NOW() - make_interval(days => $5), CURRENT_DATE + 7)`,
      [randomUUID(), f.org, resident, kind, days],
    );
  await measure(erna, "bed_rails", 10);
  await measure(otto, "belt", 3);

  // Polymedikation: 9 Wirkstoffe (eine Kombination mit zwei) in den letzten 7 Tagen verabreicht.
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  for (const [index, name] of names.entries()) {
    const medication = randomUUID();
    const order = randomUUID();
    await q(
      `INSERT INTO carecore_medications (id, organization_id, name, active_ingredient, strength) VALUES ($1, $2, $3, $4, '1 mg')`,
      [medication, f.org, `Präparat ${name}`, index === 0 ? "Stoff A, Stoff Z" : `Stoff ${name}`],
    );
    await q(`INSERT INTO carecore_medication_orders (id, resident_id, medication_id) VALUES ($1, $2, $3)`, [
      order,
      erna,
      medication,
    ]);
    await q(
      `INSERT INTO carecore_medication_administrations (id, medication_order_id, resident_id, scheduled_at, administered_at, status)
       VALUES ($1, $2, $3, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', 'administered')`,
      [randomUUID(), order, erna],
    );
  }

  // Schmerz: NRS an drei Tagen (heute, gestern, vorgestern) mindestens 4.
  const nrs = randomUUID();
  await q(
    `INSERT INTO carecore_assessments (id, organization_id, code, name, version) VALUES ($1, $2, 'NRS', 'NRS', '1')`,
    [nrs, f.org],
  );
  for (const [days, score] of [
    [0, 5],
    [1, 4],
    [2, 7],
  ])
    await q(
      `INSERT INTO carecore_assessment_records (id, assessment_id, resident_id, status, completed_at, score)
       VALUES ($1, $2, $3, 'completed', (((NOW() AT TIME ZONE 'Europe/Zurich')::date - $4::int) + TIME '12:00') AT TIME ZONE 'Europe/Zurich', $5)`,
      [randomUUID(), nrs, erna, days, score],
    );
  await q(
    `INSERT INTO carecore_assessment_records (id, assessment_id, resident_id, status, completed_at, score)
     VALUES ($1, $2, $3, 'completed', NOW(), 2)`,
    [randomUUID(), nrs, otto],
  );

  // Dekubitus: im Haus entstanden, Kategorie 2 (zählt); mitgebrachter zählt nicht.
  const wound = (resident: string, origin: string) =>
    q(
      `INSERT INTO carecore_wounds (id, resident_id, title, body_location, wound_type, category, origin)
       VALUES ($1, $2, 'Dekubitus Sakral', 'Sakralbereich', 'Dekubitus', 'Kategorie 2', $3)`,
      [randomUUID(), resident, origin],
    );
  await wound(erna, "inhouse");
  await wound(otto, "external");

  const result = await qualityIndicators(ctx, null);
  assert.equal(result.population, 2);
  const by = Object.fromEntries(result.indicators.map((indicator) => [indicator.key, indicator]));
  assert.deepEqual(
    Object.fromEntries(result.indicators.map((i) => [i.key, [i.numerator, i.denominator, i.notAssessable]])),
    {
      malnutrition: [1, 1, 1],
      trunk_restraint: [0, 2, 0],
      bed_rails: [1, 2, 0],
      polymedication: [1, 2, 0],
      pain_self: [1, 2, 0],
      pressure_ulcer: [1, 2, 0],
    },
  );
  assert.equal(by.malnutrition.percent, 100);
  assert.equal(by.bed_rails.percent, 50);
  assert.match(by.malnutrition.residents[0].detail, /5\.7 % in 30 Tagen/);
  assert.equal(by.polymedication.residents[0].detail, "9 Wirkstoffe");
  assert.match(by.pain_self.residents[0].detail, /^NRS \d+, \d+, \d+$/);
  assert.ok(result.indicators.every((i) => i.residents.every((r) => r.id === erna)));

  // Anderer Wohnbereich: niemand.
  const empty = await qualityIndicators(ctx, f.units.b);
  assert.equal(empty.population, 0);
  assert.ok(empty.indicators.every((i) => i.numerator === 0 && i.percent === null));
});
