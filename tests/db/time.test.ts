import { test } from "node:test";
import assert from "node:assert/strict";
import { RosterError, toRosterError } from "@/lib/roster/errors";
import { timesheetCsv } from "@/lib/roster/export-service";
import { getMySchedule } from "@/lib/roster/my-schedule";
import { periodAction } from "@/lib/roster/period-service";
import { getSchedule } from "@/lib/roster/schedule";
import { createShift } from "@/lib/roster/shift-service";
import { deleteWageType, getSettings, saveEmployeeProfile, saveWageType } from "@/lib/roster/settings-service";
import { localDate } from "@/lib/roster/time";
import {
  checkMissingClockOuts,
  clockIn,
  clockOut,
  decideCorrection,
  requestCorrection,
  toggleBreak,
  updateTimeEntry,
} from "@/lib/roster/time-service";
import { fixture, q, type Fixture } from "../support/db";

const code = (error: unknown) => (error instanceof RosterError ? error.code : String(error));
const expectCode = async (promise: Promise<unknown>, expected: string) =>
  assert.equal(await promise.then(() => "OK", code), expected);
const TZ = "Europe/Zurich";
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

// Veröffentlichter Dienst, der gerade läuft (Beginn vor 30 Min, 8 h inkl. 30 Min Pause).
async function runningShift(f: Fixture, person: string) {
  const start = new Date(Date.now() - 30 * 60_000);
  const end = new Date(start.getTime() + 8 * 3_600_000);
  const lead = await f.ctx("leadA");
  const { shiftIds } = await createShift(lead, {
    unitId: f.units.a,
    employeeId: f.people[person],
    shiftTypeId: await f.type("F"),
    date: localDate(start, TZ),
    plannedStart: start.toISOString(),
    plannedEnd: end.toISOString(),
    breakMinutes: 30,
    acknowledgedWarnings: ["MIN_STAFFING", "MIN_QUALIFIED"],
    overrideReason: "Test",
  });
  await q(`UPDATE carecore_schedule_periods SET status = 'PUBLISHED' WHERE care_unit_id = $1`, [f.units.a]);
  return shiftIds[0];
}

const notifications = async (userId: string, type: string) =>
  (
    await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE user_id = $1 AND type = $2`, [
      userId,
      type,
    ])
  )[0].n;

test("Geplanter Dienst: Einstempeln, Pause, Ausstempeln – Ist serverseitig, Abweichung und Pause markiert", async () => {
  const f = await fixture();
  const shiftId = await runningShift(f, "anna");
  const anna = await f.ctx("anna");
  const started = await clockIn(anna, { shiftId });
  assert.deepEqual({ shiftId: started.shiftId, unplanned: started.unplanned }, { shiftId, unplanned: false });
  await expectCode(clockIn(anna, {}), "ALREADY_CLOCKED_IN");

  // Pause 20 Min (Beginn der Pause zurückdatiert, das Ende setzt der Server).
  await toggleBreak(anna, "start");
  await expectCode(toggleBreak(anna, "start"), "INVALID");
  await q(`UPDATE carecore_time_entries SET break_started_at = $2 WHERE id = $1`, [started.id, minutesAgo(20)]);
  await toggleBreak(anna, "end");

  // 11 h statt 7:30 h geplant: +3:10 h, Pausenstaffel (60 Min ab 9 h) unterschritten.
  await q(`UPDATE carecore_time_entries SET clock_in = $2 WHERE id = $1`, [started.id, minutesAgo(11 * 60)]);
  const result = await clockOut(anna, { note: "Notfall auf der Station" });
  assert.equal(result.breakMinutes, 20);
  assert.ok(Math.abs(result.actualMinutes - (11 * 60 - 20)) <= 1);
  assert.ok(Math.abs((result.differenceMinutes ?? 0) - (11 * 60 - 20 - 450)) <= 1);
  assert.equal(result.breakShortfall, 40);
  const [entry] = await q<{ status: string; actual_minutes: number }>(
    `SELECT status, actual_minutes FROM carecore_time_entries WHERE id = $1`,
    [started.id],
  );
  assert.equal(entry.status, "COMPLETE");
  assert.equal(entry.actual_minutes, result.actualMinutes);
  assert.equal(await notifications(f.people.leadA, "shift_time_deviation"), 1);
  await expectCode(clockOut(anna, {}), "INVALID");
});

test("Ohne Pause wird beim Ausstempeln die geplante Pause angerechnet", async () => {
  const f = await fixture();
  const shiftId = await runningShift(f, "max");
  const max = await f.ctx("max");
  const { id } = await clockIn(max, { shiftId });
  await q(`UPDATE carecore_time_entries SET clock_in = $2 WHERE id = $1`, [id, minutesAgo(8 * 60)]);
  const result = await clockOut(max, {});
  assert.equal(result.breakMinutes, 30);
  assert.ok(Math.abs(result.actualMinutes - 450) <= 1);
  assert.equal(await notifications(f.people.leadA, "shift_time_deviation"), 0);
});

test("Ungeplanter Einsatz informiert die Leitung; Stempeln geht auch ohne planbare Zuordnung", async () => {
  const f = await fixture();
  const max = await f.ctx("max");
  const unplanned = await clockIn(max, {});
  assert.equal(unplanned.unplanned, true);
  assert.equal(await notifications(f.people.leadA, "shift_unplanned_work"), 1);
  // Die Leitung ist in Wohngruppe A nicht planbar, hat dort aber ihren Stammwohnbereich.
  const lead = await f.ctx("leadA");
  const own = await clockIn(lead, {});
  const [entry] = await q<{ care_unit_id: string }>(`SELECT care_unit_id FROM carecore_time_entries WHERE id = $1`, [
    own.id,
  ]);
  assert.equal(entry.care_unit_id, f.units.a);
  // Einen fremden Wohnbereich gibt es nicht.
  await expectCode(clockIn(await f.ctx("anna"), { careUnitId: "00000000-0000-4000-8000-000000000000" }), "NOT_FOUND");
});

test("Fehlender Clock-out: unvollständig, keine Zeit geraten, Person und Leitung informiert", async () => {
  const f = await fixture();
  const lea = await f.ctx("lea");
  const { id } = await clockIn(lea, {});
  await q(`UPDATE carecore_time_entries SET clock_in = $2 WHERE id = $1`, [id, minutesAgo(20 * 60)]);
  await checkMissingClockOuts(await f.ctx("leadA"));
  const [entry] = await q<{ status: string; actual_minutes: number | null; clock_out: string | null }>(
    `SELECT status, actual_minutes, clock_out FROM carecore_time_entries WHERE id = $1`,
    [id],
  );
  assert.deepEqual(entry, { status: "INCOMPLETE", actual_minutes: null, clock_out: null });
  assert.equal(await notifications(f.people.lea, "shift_clock_out_missing"), 1);
  assert.equal(await notifications(f.people.leadA, "shift_clock_out_missing"), 1);
  // Zweiter Lauf meldet nicht doppelt; neues Einstempeln ist wieder möglich.
  await checkMissingClockOuts(await f.ctx("leadA"));
  assert.equal(await notifications(f.people.lea, "shift_clock_out_missing"), 1);
  await clockIn(lea, {});
});

test("Korrektur: beantragen, Leitung entscheidet; abgeschlossener Monat sperrt, Öffnen nur mit Begründung", async () => {
  const f = await fixture();
  const sam = await f.ctx("sam");
  const lead = await f.ctx("leadA");
  const { id } = await clockIn(sam, { careUnitId: f.units.a });
  await q(`UPDATE carecore_time_entries SET clock_in = $2 WHERE id = $1`, [id, minutesAgo(8 * 60)]);
  await clockOut(sam, {});
  const corrected = minutesAgo(30);
  const { id: correctionId } = await requestCorrection(sam, id, {
    clockOut: corrected,
    reason: "Zu spät ausgestempelt",
  });
  assert.equal(await notifications(f.people.leadA, "shift_time_correction_requested"), 1);
  await expectCode(decideCorrection(await f.ctx("anna"), correctionId, { decision: "APPROVED" }), "FORBIDDEN");
  await decideCorrection(lead, correctionId, { decision: "APPROVED", comment: "Ok" });
  const [entry] = await q<{ clock_out: Date; version: number }>(
    `SELECT clock_out, version FROM carecore_time_entries WHERE id = $1`,
    [id],
  );
  assert.equal(new Date(entry.clock_out).toISOString(), corrected);
  assert.equal(await notifications(f.people.sam, "shift_time_correction_decided"), 1);
  const [audit] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_roster_audit WHERE entity_type = 'time_entry' AND entity_id = $1`,
    [id],
  );
  assert.ok(audit.n >= 3);

  // Monatsabschluss sperrt Korrekturen; Wiedereröffnen braucht eine Begründung.
  const today = localDate(new Date(), TZ);
  const plan = await getSchedule(lead, {
    unitId: f.units.a,
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  });
  await periodAction(lead, plan.period!.id, { action: "lock", expectedVersion: plan.period!.version });
  await expectCode(
    updateTimeEntry(lead, id, { expectedVersion: entry.version, breakMinutes: 45, reason: "Nachtrag" }),
    "PERIOD_LOCKED",
  );
  await expectCode(requestCorrection(sam, id, { breakMinutes: 45, reason: "Nachtrag" }), "PERIOD_LOCKED");
  const [locked] = await q<{ version: number }>(`SELECT version FROM carecore_schedule_periods WHERE id = $1`, [
    plan.period!.id,
  ]);
  await expectCode(
    periodAction(lead, plan.period!.id, { action: "unlock", expectedVersion: locked.version }),
    "INVALID",
  );
  await periodAction(lead, plan.period!.id, {
    action: "unlock",
    expectedVersion: locked.version,
    reason: "Nachtrag Lohn",
  });
  const [current] = await q<{ version: number; status: string }>(
    `SELECT version, status FROM carecore_time_entries WHERE id = $1`,
    [id],
  );
  await updateTimeEntry(lead, id, { expectedVersion: current.version, breakMinutes: 45, reason: "Nachtrag" });
  // Mit veralteter Version wird nichts überschrieben.
  await expectCode(
    updateTimeEntry(lead, id, { expectedVersion: current.version, breakMinutes: 30, reason: "Doppelt" }),
    "STALE_VERSION",
  );
});

test("Stammwohnbereich ist die Vorauswahl in Teamplan und Zeiterfassung", async () => {
  const f = await fixture();
  // Sam arbeitet in A und B; Stammwohnbereich wird B.
  await q(`UPDATE carecore_user_profiles SET primary_care_unit_id = $2 WHERE user_id = $1`, [f.people.sam, f.units.b]);
  const sam = await f.ctx("sam");
  assert.equal(sam.access.memberUnitIds[0], f.units.b);
  const today = localDate(new Date(), TZ);
  const team = await getSchedule(sam, {
    unitId: null,
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    team: true,
  });
  assert.equal(team.unit.id, f.units.b);
  // Ungeplantes Einstempeln landet im Stammwohnbereich.
  const { id } = await clockIn(sam, {});
  const [entry] = await q<{ care_unit_id: string }>(`SELECT care_unit_id FROM carecore_time_entries WHERE id = $1`, [
    id,
  ]);
  assert.equal(entry.care_unit_id, f.units.b);
  const mine = await getMySchedule(sam, { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  assert.equal(mine.openEntry?.id, id);
});

test("Arbeitszeit-Export: Summen und Einträge als CSV, nur für die Leitung", async () => {
  const f = await fixture();
  const shiftId = await runningShift(f, "anna");
  const anna = await f.ctx("anna");
  const { id } = await clockIn(anna, { shiftId });
  await q(`UPDATE carecore_time_entries SET clock_in = $2 WHERE id = $1`, [id, minutesAgo(8 * 60)]);
  await clockOut(anna, {});
  const lead = await f.ctx("leadA");
  const month = localDate(new Date(), TZ).slice(0, 7);
  const sums = await timesheetCsv(lead, new URLSearchParams({ monat: month, einheit: f.units.a }));
  assert.match(sums.filename, new RegExp(`^arbeitszeit-summen-wohngruppe-a-${month}\\.csv$`));
  const lines = sums.body.replace("\uFEFF", "").trim().split("\r\n");
  assert.match(lines[0], /^Monat;Wohnbereich;Person;Pensum %;Soll \(h\);Geplant \(h\);Ist \(h\);Saldo \(h\)/);
  const annaLine = lines.find((line) => line.includes("Anna Müller"))!;
  assert.ok(annaLine.startsWith(`${month};Wohngruppe A;Anna Müller;100;`));
  assert.equal(annaLine.split(";")[6], "7,5");
  const entries = await timesheetCsv(lead, new URLSearchParams({ monat: month, einheit: f.units.a, art: "eintraege" }));
  const entryLines = entries.body.trim().split("\r\n");
  assert.equal(entryLines.length, 2);
  assert.match(entryLines[1], /Anna Müller;Frühdienst;/);
  // Mitarbeitende erhalten keinen Export des Wohnbereichs.
  await expectCode(timesheetCsv(anna, new URLSearchParams({ monat: month, einheit: f.units.a })), "FORBIDDEN");
});

test("Lohn-Export: Lohnarten der Einrichtung, Personalnummer, nur Personen mit diesem Stammwohnbereich", async () => {
  const f = await fixture();
  const shiftId = await runningShift(f, "anna");
  const anna = await f.ctx("anna");
  const { id } = await clockIn(anna, { shiftId });
  await q(`UPDATE carecore_time_entries SET clock_in = $2 WHERE id = $1`, [id, minutesAgo(8 * 60)]);
  await clockOut(anna, {});
  const lead = await f.ctx("leadA");
  const month = localDate(new Date(), TZ).slice(0, 7);
  const params = () => new URLSearchParams({ monat: month, einheit: f.units.a, art: "lohn" });

  // Ohne Lohnarten gibt es keine Lohndatei; Lohnarten pflegt nur die Leitung.
  await expectCode(timesheetCsv(lead, params()), "INVALID");
  await expectCode(saveWageType(anna, { code: "1000", name: "Stundenlohn", source: "ACTUAL_HOURS" }), "FORBIDDEN");
  await expectCode(saveWageType(lead, { code: "1000", name: "Stundenlohn", source: "ERFUNDEN" }), "INVALID");
  await saveWageType(lead, { code: "1000", name: "Stundenlohn", source: "ACTUAL_HOURS" });
  const night = await saveWageType(lead, { code: "1100", name: "Nachtstunden", source: "NIGHT_HOURS" });
  const duplicate = await saveWageType(lead, { code: "1000", name: "Doppelt", source: "TARGET_HOURS" }).catch(
    (error: unknown) => toRosterError(error)?.message,
  );
  assert.equal(duplicate, "Diese Lohnart-Nummer ist bereits vergeben.");
  await saveEmployeeProfile(lead, f.people.anna, { employeeNumber: " P-0042 " });
  const settings = await getSettings(lead, f.units.a);
  assert.deepEqual(
    settings.wageTypes.map((w) => w.code),
    ["1000", "1100"],
  );
  assert.equal(settings.employees.find((e) => e.id === f.people.anna)?.employeeNumber, "P-0042");

  const payroll = await timesheetCsv(lead, params());
  assert.match(payroll.filename, new RegExp(`^arbeitszeit-lohn-wohngruppe-a-${month}\\.csv$`));
  const lines = payroll.body.replace("\uFEFF", "").trim().split("\r\n");
  assert.equal(lines[0], "Periode;Personalnummer;Person;Lohnart;Bezeichnung;Menge;Einheit");
  // Nur Werte ungleich null: Anna hat 7,5 Ist-Stunden; Nachtstunden je nach Uhrzeit des Tests.
  const annaLines = lines.filter((line) => line.includes("Anna Müller"));
  assert.ok(annaLines.includes(`${month};P-0042;Anna Müller;1000;Stundenlohn;7,5;Stunden`));
  assert.ok(lines.slice(1).every((line) => !line.endsWith(";0;Stunden")));

  // Stammwohnbereich B: Anna erscheint nicht mehr im Export von A (keine doppelte Abrechnung).
  await q(
    `INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead) VALUES ($1, $2, TRUE, FALSE)`,
    [f.people.anna, f.units.b],
  );
  await q(`UPDATE carecore_user_profiles SET primary_care_unit_id = $2 WHERE user_id = $1`, [f.people.anna, f.units.b]);
  const after = await timesheetCsv(lead, params());
  assert.ok(!after.body.includes("Anna Müller"));

  await deleteWageType(lead, night.id);
  assert.equal((await getSettings(lead, f.units.a)).wageTypes.length, 1);
  const audits = await q<{ action: string }>(
    `SELECT action FROM carecore_roster_audit WHERE entity_type = 'wage_type' AND organization_id = $1 ORDER BY created_at`,
    [f.org],
  );
  assert.deepEqual(
    audits.map((a) => a.action),
    ["created", "created", "deleted"],
  );
  // Mitarbeitende erhalten keine Lohndatei, auch nicht für die eigenen Zeiten.
  await expectCode(timesheetCsv(anna, new URLSearchParams({ monat: month, eigene: "1", art: "lohn" })), "INVALID");
});
