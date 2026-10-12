import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, pool, q } from "../support/db";

async function period(org: string, unit: string) {
  const [row] = await q<{ id: string }>(
    `INSERT INTO carecore_schedule_periods (organization_id, care_unit_id, year, month) VALUES ($1, $2, 2026, 10) RETURNING id`,
    [org, unit],
  );
  return row.id;
}

async function insertShift(
  f: Awaited<ReturnType<typeof fixture>>,
  periodId: string,
  employee: string,
  code: string,
  start: string,
  end: string,
  category = "WORK",
) {
  const [row] = await q<{ id: string }>(
    `INSERT INTO carecore_roster_shifts (organization_id, period_id, care_unit_id, employee_id, shift_type_id, category, date,
       planned_start, planned_end) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz::date, $7, $8) RETURNING id`,
    [f.org, periodId, f.units.a, employee, await f.type(code), category, start, end],
  );
  return row.id;
}

test("Overlap-Constraint greift auch bei direktem Insert", async () => {
  const f = await fixture();
  const p = await period(f.org, f.units.a);
  await insertShift(f, p, f.people.anna, "F", "2026-10-12T05:00:00Z", "2026-10-12T13:30:00Z");
  await assert.rejects(
    insertShift(f, p, f.people.anna, "S", "2026-10-12T11:30:00Z", "2026-10-12T20:00:00Z"),
    (error: { code?: string }) => error.code === "23P01",
  );
  // Abwesenheiten sind ausgenommen.
  await insertShift(f, p, f.people.anna, "U", "2026-10-12T06:00:00Z", "2026-10-12T14:24:00Z", "ABSENCE");
});

test("Tausch darf innerhalb einer Transaktion kurz überlappen (DEFERRABLE)", async () => {
  const f = await fixture();
  const p = await period(f.org, f.units.a);
  const a = await insertShift(f, p, f.people.anna, "F", "2026-10-13T05:00:00Z", "2026-10-13T13:30:00Z");
  const b = await insertShift(f, p, f.people.max, "F", "2026-10-13T05:00:00Z", "2026-10-13T13:30:00Z");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE carecore_roster_shifts SET employee_id = $1 WHERE id = $2`, [f.people.max, a]);
    await client.query(`UPDATE carecore_roster_shifts SET employee_id = $1 WHERE id = $2`, [f.people.anna, b]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
});

test("Audit-Log ist unveränderlich", async () => {
  const f = await fixture();
  const [row] = await q<{ id: string }>(
    `INSERT INTO carecore_roster_audit (organization_id, actor_label, action, entity_type, source, correlation_id)
     VALUES ($1, 'Test', 'created', 'shift', 'SYSTEM', $2) RETURNING id`,
    [f.org, randomUUID()],
  );
  await assert.rejects(q(`UPDATE carecore_roster_audit SET action = 'x' WHERE id = $1`, [row.id]), /unveränderlich/);
  await assert.rejects(q(`DELETE FROM carecore_roster_audit WHERE id = $1`, [row.id]), /unveränderlich/);
  await assert.rejects(q(`TRUNCATE carecore_roster_audit`), /unveränderlich/);
});

test("höchstens ein offener Zeiteintrag pro Person", async () => {
  const f = await fixture();
  const insert = () =>
    q(
      `INSERT INTO carecore_time_entries (organization_id, employee_id, care_unit_id, date, clock_in, status)
       VALUES ($1, $2, $3, '2026-10-12', NOW(), 'OPEN')`,
      [f.org, f.people.anna, f.units.a],
    );
  await insert();
  await assert.rejects(insert(), (error: { code?: string }) => error.code === "23505");
});

test("höchstens ein aktiver Tausch pro Quelldienst", async () => {
  const f = await fixture();
  const p = await period(f.org, f.units.a);
  const a = await insertShift(f, p, f.people.anna, "F", "2026-10-14T05:00:00Z", "2026-10-14T13:30:00Z");
  const insert = (target: string) =>
    q(
      `INSERT INTO carecore_shift_swaps (organization_id, care_unit_id, requester_id, target_employee_id, source_shift_id,
         source_shift_version) VALUES ($1, $2, $3, $4, $5, 1)`,
      [f.org, f.units.a, f.people.anna, target, a],
    );
  await insert(f.people.max);
  await assert.rejects(insert(f.people.lea), (error: { code?: string }) => error.code === "23505");
});

test("Dienst mit Zeiteintrag kann nicht gelöscht werden", async () => {
  const f = await fixture();
  const p = await period(f.org, f.units.a);
  const a = await insertShift(f, p, f.people.anna, "F", "2026-10-15T05:00:00Z", "2026-10-15T13:30:00Z");
  await q(
    `INSERT INTO carecore_time_entries (organization_id, employee_id, care_unit_id, shift_id, date, clock_in, clock_out, status)
     VALUES ($1, $2, $3, $4, '2026-10-15', '2026-10-15T05:00:00Z', '2026-10-15T13:30:00Z', 'COMPLETE')`,
    [f.org, f.people.anna, f.units.a, a],
  );
  await assert.rejects(
    q(`DELETE FROM carecore_roster_shifts WHERE id = $1`, [a]),
    (error: { code?: string }) => error.code === "23503",
  );
});
