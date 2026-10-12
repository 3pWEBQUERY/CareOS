import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRun, executeRun, getRun, setModelCall, startRun } from "@/lib/roster/ai";
import { RosterError } from "@/lib/roster/errors";
import { createTimeOff } from "@/lib/roster/request-service";
import { addDays, localDate, shiftMonth } from "@/lib/roster/time";
import type { RuleCode } from "@/lib/roster/types";
import { fixture, q } from "../support/db";

// Test-Double statt Mistral: antwortet deterministisch und hält die gesendeten Prompts fest.
type Input = { zeitraum: { from: string; to: string }; personen: Array<{ ref: string }>; abgelehnt?: unknown };
const today = localDate(new Date(), "Europe/Zurich");
const next = shiftMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1);
const monthKey = `${next.year}-${String(next.month).padStart(2, "0")}`;
const from = `${monthKey}-08`;
const to = `${monthKey}-10`;

test("ohne MISTRAL_API_KEY ist die KI sauber deaktiviert", async () => {
  const f = await fixture();
  const previous = process.env.MISTRAL_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  try {
    const error = await startRun(await f.ctx("leadA"), { unitId: f.units.a, month: monthKey }).catch((e) => e);
    assert.ok(error instanceof RosterError);
    assert.equal(error.code, "AI_UNAVAILABLE");
    assert.equal(error.status, 503);
    const [runs] = await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM carecore_ai_planning_runs WHERE organization_id = $1`,
      [f.org],
    );
    assert.equal(runs.n, 0);
  } finally {
    if (previous !== undefined) process.env.MISTRAL_API_KEY = previous;
  }
});

test("KI-Planung: pseudonymisierte Eingabe, Regelprüfung jeder Zuweisung, Übernahme nur als Entwurf", async () => {
  const f = await fixture();
  const lead = await f.ctx("leadA");
  await createTimeOff(await f.ctx("anna"), {
    startDate: to,
    reason: "Familienfest",
    comment: "Hochzeit meiner Schwester",
  });
  const prompts: string[] = [];
  setModelCall(async ({ system, user }) => {
    prompts.push(system, user);
    const input = JSON.parse(user) as Input;
    if (input.abgelehnt) return JSON.stringify({ assignments: [], notes: [] });
    const [first, second] = input.personen.map((p) => p.ref);
    const day = input.zeitraum.from;
    return JSON.stringify({
      assignments: [
        { employeeRef: first, date: day, shiftTypeCode: "F" },
        // Unbekannte Person und unbekannter Code: verwerfen.
        { employeeRef: "E99", date: day, shiftTypeCode: "F" },
        { employeeRef: second, date: day, shiftTypeCode: "QQ" },
        // Spätdienst und am Folgetag Frühdienst: Ruhezeitverstoss, der zweite wird verworfen.
        { employeeRef: second, date: day, shiftTypeCode: "S" },
        ...(day < input.zeitraum.to ? [{ employeeRef: second, date: addDays(day, 1), shiftTypeCode: "F" }] : []),
      ],
      notes: [{ date: day, text: `${first} übernimmt den Frühdienst.` }],
    });
  });
  process.env.MISTRAL_API_KEY = "test-double";
  try {
    const { id } = await startRun(lead, { unitId: f.units.a, month: monthKey, from, to });
    await executeRun(lead, id);
    const run = await getRun(lead, id);
    assert.equal(run.status, "SUCCEEDED", run.error ?? "");

    // Keine Namen, keine Gründe, keine Kommentare, keine IDs an die KI.
    const sent = prompts.join("\n");
    for (const secret of ["Anna", "Müller", "Max", "Familienfest", "Hochzeit", f.people.anna, f.people.max])
      assert.ok(!sent.includes(secret), `„${secret}“ darf nicht an die KI gehen`);

    const discarded = run.assignments.filter((a) => a.status === "discarded");
    assert.ok(discarded.some((a) => /Unbekannte Person/.test(a.reason ?? "")));
    assert.ok(discarded.some((a) => /Unbekannter Diensttyp/.test(a.reason ?? "")));
    assert.ok(discarded.some((a) => a.violations.some((v) => v.code === "REST_TIME")));
    // In der Anzeige stehen wieder echte Namen.
    assert.ok(run.notes.every((n) => !/\bE\d+\b/.test(n.text)));
    const valid = run.assignments.filter((a) => a.status === "valid" && !a.existing);
    assert.ok(valid.length >= 2);

    // Übernahme: Warnungen (z. B. Besetzung) werden mit Begründung bestätigt; der Monat bleibt Entwurf.
    const apply = (ack: { acknowledgedWarnings?: RuleCode[]; overrideReason?: string }) => applyRun(lead, id, ack);
    await apply({}).catch((error: unknown) => {
      if (!(error instanceof RosterError) || error.code !== "CONFIRMATION_REQUIRED") throw error;
      return apply({
        acknowledgedWarnings: (error.violations ?? []).map((v) => v.code),
        overrideReason: "Testlauf",
      });
    });
    const shifts = await q<{ source: string }>(
      `SELECT source FROM carecore_roster_shifts WHERE care_unit_id = $1 AND date BETWEEN $2 AND $3`,
      [f.units.a, from, to],
    );
    assert.equal(shifts.length, valid.length);
    assert.ok(shifts.every((s) => s.source === "AI"));
    const [period] = await q<{ status: string }>(
      `SELECT status FROM carecore_schedule_periods WHERE care_unit_id = $1 AND year = $2 AND month = $3`,
      [f.units.a, next.year, next.month],
    );
    assert.equal(period.status, "DRAFT");
    const [audit] = await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM carecore_roster_audit WHERE entity_id = $1 AND action = 'ai_applied'`,
      [id],
    );
    assert.equal(audit.n, 1);
    // Ein zweites Übernehmen ist nicht möglich.
    const again = await applyRun(lead, id, {}).catch((e) => e);
    assert.ok(again instanceof RosterError);
  } finally {
    delete process.env.MISTRAL_API_KEY;
  }
});

test("KI-Antwort mit ungültigem JSON: Lauf schlägt mit klarer Meldung fehl", async () => {
  const f = await fixture();
  const lead = await f.ctx("leadA");
  setModelCall(async () => "Hier ist Ihr Plan: …");
  process.env.MISTRAL_API_KEY = "test-double";
  try {
    const { id } = await startRun(lead, { unitId: f.units.a, month: monthKey, from, to });
    await executeRun(lead, id);
    const run = await getRun(lead, id);
    assert.equal(run.status, "FAILED");
    assert.match(run.error ?? "", /kein gültiges JSON/);
    const [shifts] = await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM carecore_roster_shifts WHERE care_unit_id = $1`,
      [f.units.a],
    );
    assert.equal(shifts.n, 0);
  } finally {
    delete process.env.MISTRAL_API_KEY;
  }
});

test("Mitarbeitende dürfen die KI nicht verwenden", async () => {
  const f = await fixture();
  process.env.MISTRAL_API_KEY = "test-double";
  try {
    const error = await startRun(await f.ctx("anna"), { unitId: f.units.a, month: monthKey }).catch((e) => e);
    assert.ok(error instanceof RosterError);
    assert.equal(error.code, "FORBIDDEN");
  } finally {
    delete process.env.MISTRAL_API_KEY;
  }
});
