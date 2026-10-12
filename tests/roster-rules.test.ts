import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSchedule, blocking, unacknowledged, validateChanges } from "@/lib/roster/rules";
import type { ShiftChange, Violation } from "@/lib/roster/types";
import { employee, shift, snapshot, UNIT } from "./support/roster-fixtures";

const codes = (violations: Violation[]) => violations.map((v) => v.code).sort();
const create = (id: string, employeeId: string, shiftTypeId: string, date: string): ShiftChange => ({
  kind: "create",
  shift: { id, unitId: UNIT, employeeId, shiftTypeId, date },
});

test("Spät (Ende 22:00) → Früh (Beginn 06:30) am Folgetag verletzt die Ruhezeit", () => {
  const snap = snapshot({ shifts: [shift({ id: "s1", employeeId: "e1", shiftTypeId: "S", date: "2026-10-12" })] });
  const result = validateChanges(snap, [create("new", "e1", "F", "2026-10-13")]);
  const rest = result.find((v) => v.code === "REST_TIME");
  assert.equal(rest?.severity, "BLOCK");
  assert.equal(
    rest?.message,
    "Zwischen Spätdienst (Ende 22:00) und Frühdienst (Beginn 06:30) liegen nur 8:30 h statt 11:00 h.",
  );
});

test("Ruhezeit über die Monatsgrenze (30.09. Spät → 01.10. Früh)", () => {
  const snap = snapshot({ shifts: [shift({ id: "s1", employeeId: "e1", shiftTypeId: "S", date: "2026-09-30" })] });
  assert.ok(codes(validateChanges(snap, [create("new", "e1", "F", "2026-10-01")])).includes("REST_TIME"));
});

test("Überschneidung wird blockiert", () => {
  const snap = snapshot({ shifts: [shift({ id: "s1", employeeId: "e1", shiftTypeId: "S", date: "2026-10-12" })] });
  const result = validateChanges(snap, [create("new", "e1", "F", "2026-10-12")]);
  const overlap = result.find((v) => v.code === "OVERLAP");
  assert.equal(overlap?.message, "Anna Müller ist am 12.10. bereits von 13:30–22:00 eingeteilt.");
});

test("Abwesenheit und genehmigtes Wunschfrei blockieren", () => {
  const snap = snapshot({
    shifts: ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"].map((date, i) =>
      shift({ id: `u${i}`, employeeId: "e1", shiftTypeId: "U", date }),
    ),
    timeOff: [
      {
        id: "t1",
        employeeId: "e2",
        unitId: UNIT,
        startDate: "2026-10-12",
        endDate: "2026-10-12",
        priority: "HIGH",
        status: "APPROVED",
      },
    ],
  });
  const absence = validateChanges(snap, [create("n1", "e1", "F", "2026-10-12")]).find(
    (v) => v.code === "ABSENCE_CONFLICT",
  );
  assert.equal(absence?.message, "Anna Müller ist vom 10.10.–14.10. abwesend.");
  const timeOff = validateChanges(snap, [create("n2", "e2", "F", "2026-10-12")]).find(
    (v) => v.code === "APPROVED_TIME_OFF",
  );
  assert.equal(timeOff?.message, "Für Max Meier ist am 12.10. Wunschfrei genehmigt.");
});

test("fehlende Qualifikation, ausgeschlossene Kategorie und inaktive Person blockieren", () => {
  const snap = snapshot({
    employees: {
      e1: employee("e1", {
        excludedCategories: ["NIGHT"],
        qualifications: [{ qualificationId: "q-hf", validFrom: "2020-01-01", validUntil: null }],
      }),
      e2: employee("e2"),
      e3: employee("e3", { employmentEnd: "2026-09-30" }),
    },
  });
  assert.equal(
    validateChanges(snap, [create("n1", "e2", "N", "2026-10-14")]).find((v) => v.code === "QUALIFICATION_MISSING")
      ?.message,
    "Nachtdienst erfordert „Pflegefachperson HF“ – fehlt bei Max Meier.",
  );
  assert.equal(
    validateChanges(snap, [create("n2", "e1", "N", "2026-10-14")]).find((v) => v.code === "EXCLUDED_CATEGORY")?.message,
    "Anna Müller ist nicht für Nachtdienste einplanbar.",
  );
  assert.equal(
    validateChanges(snap, [create("n3", "e3", "F", "2026-10-14")]).find((v) => v.code === "EMPLOYEE_INACTIVE")?.message,
    "Lea Beispiel ist ab 01.10.2026 nicht mehr angestellt.",
  );
});

test("Person ausserhalb der eigenen Wohngruppe", () => {
  const snap = snapshot({ employees: { e1: employee("e1", { unitIds: ["unit-b"] }) } });
  assert.deepEqual(codes(blocking(validateChanges(snap, [create("n1", "e1", "F", "2026-10-14")]))), ["OUT_OF_SCOPE"]);
});

test("maximale Tagesarbeitszeit", () => {
  const result = validateChanges(snapshot(), [create("n1", "e1", "L", "2026-10-14")]);
  assert.equal(
    result.find((v) => v.code === "MAX_DAILY_WORK")?.message,
    "Dienst überschreitet die maximale Tagesarbeitszeit (11:00 h > 10:00 h).",
  );
});

test("Mindestbesetzung unterschritten ist eine Warnung, kein Blocker", () => {
  const staffing = [
    {
      id: "r1",
      unitId: UNIT,
      shiftTypeId: "S",
      weekday: 3,
      date: null,
      minCount: 3,
      maxCount: null,
      minQualified: null,
      qualificationId: null,
    },
  ];
  const snap = snapshot({
    staffing,
    shifts: [
      shift({ id: "a", employeeId: "e1", shiftTypeId: "S", date: "2026-10-14" }),
      shift({ id: "b", employeeId: "e2", shiftTypeId: "S", date: "2026-10-14" }),
      shift({ id: "c", employeeId: "e3", shiftTypeId: "S", date: "2026-10-14" }),
    ],
  });
  const result = validateChanges(snap, [{ kind: "delete", shiftId: "c", expectedVersion: 1 }]);
  assert.equal(blocking(result).length, 0);
  const warning = result.find((v) => v.code === "MIN_STAFFING");
  assert.equal(warning?.severity, "WARN");
  assert.equal(warning?.message, "Mittwoch 14.10., Spätdienst: 2 von mindestens 3 Personen.");
  assert.deepEqual(codes(unacknowledged(result, [])), ["MIN_STAFFING"]);
  assert.deepEqual(unacknowledged(result, ["MIN_STAFFING"]), []);
  // Adding someone to an understaffed day does not ask for confirmation again.
  const adding = validateChanges({ ...snap, shifts: snap.shifts.slice(0, 1) }, [create("n", "e4", "S", "2026-10-14")]);
  assert.equal(adding.filter((v) => v.code === "MIN_STAFFING").length, 0);
});

test("veraltete Version und Dienst mit Zeiteintrag", () => {
  const snap = snapshot({
    shifts: [
      shift({ id: "a", employeeId: "e1", shiftTypeId: "F", date: "2026-10-14", version: 3 }),
      shift({ id: "b", employeeId: "e2", shiftTypeId: "F", date: "2026-10-14", hasTimeEntry: true }),
    ],
  });
  assert.deepEqual(codes(validateChanges(snap, [{ kind: "delete", shiftId: "a", expectedVersion: 2 }])), [
    "STALE_VERSION",
  ]);
  assert.deepEqual(codes(validateChanges(snap, [{ kind: "delete", shiftId: "b", expectedVersion: 1 }])), [
    "SHIFT_HAS_TIME_ENTRY",
  ]);
});

test("abgeschlossener Monat", () => {
  const snap = snapshot();
  snap.periods = snap.periods.map((p) => (p.month === 9 ? { ...p, lockedAt: "2026-10-05T00:00:00Z" } : p));
  assert.equal(
    validateChanges(snap, [create("n", "e1", "F", "2026-09-14")]).find((v) => v.code === "PERIOD_LOCKED")?.message,
    "Der Monat September 2026 ist abgeschlossen.",
  );
});

test("Verschieben behält die Uhrzeiten und prüft den neuen Tag", () => {
  const snap = snapshot({
    shifts: [
      shift({ id: "a", employeeId: "e1", shiftTypeId: "F", date: "2026-10-14" }),
      shift({ id: "b", employeeId: "e2", shiftTypeId: "S", date: "2026-10-14" }),
    ],
  });
  assert.equal(
    blocking(
      validateChanges(snap, [{ kind: "move", shiftId: "a", expectedVersion: 1, employeeId: "e1", date: "2026-10-16" }]),
    ).length,
    0,
  );
  assert.ok(
    codes(
      validateChanges(snap, [{ kind: "move", shiftId: "a", expectedVersion: 1, employeeId: "e2", date: "2026-10-14" }]),
    ).includes("OVERLAP"),
  );
});

test("Tausch prüft beide Personen", () => {
  const snap = snapshot({
    shifts: [
      shift({ id: "a", employeeId: "e1", shiftTypeId: "F", date: "2026-10-14" }),
      shift({ id: "b", employeeId: "e2", shiftTypeId: "S", date: "2026-10-14" }),
      // e1 hat am Folgetag Frühdienst: nach dem Tausch hätte e1 Spät → Früh.
      shift({ id: "c", employeeId: "e1", shiftTypeId: "F", date: "2026-10-15" }),
    ],
  });
  const result = validateChanges(snap, [
    {
      kind: "swap",
      sourceShiftId: "a",
      sourceVersion: 1,
      targetEmployeeId: "e2",
      targetShiftId: "b",
      targetVersion: 1,
    },
  ]);
  assert.ok(codes(blocking(result)).includes("REST_TIME"));
  const ok = validateChanges({ ...snap, shifts: snap.shifts.slice(0, 2) }, [
    {
      kind: "swap",
      sourceShiftId: "a",
      sourceVersion: 1,
      targetEmployeeId: "e2",
      targetShiftId: "b",
      targetVersion: 1,
    },
  ]);
  assert.equal(blocking(ok).length, 0);
});

test("Wochenmaximum und Folgetage sind Warnungen", () => {
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
  const snap = snapshot({
    ruleSet: { ...snapshot().ruleSet, maxWeeklyWorkMinutes: 2800 },
    shifts: days.map((date, i) => shift({ id: `f${i}`, employeeId: "e1", shiftTypeId: "F", date })),
  });
  const result = validateChanges(snap, [create("n", "e1", "F", "2026-10-18")]);
  assert.equal(
    result.find((v) => v.code === "MAX_CONSECUTIVE_DAYS")?.message,
    "Anna Müller hätte 7 Arbeitstage am Stück (max. 6).",
  );
  assert.equal(result.find((v) => v.code === "MAX_WEEKLY_WORK")?.severity, "WARN");
  assert.equal(blocking(result).length, 0);
});

test("Wunschfrei offen und Dienstwunsch sind Hinweise", () => {
  const snap = snapshot({
    timeOff: [
      {
        id: "t",
        employeeId: "e1",
        unitId: UNIT,
        startDate: "2026-10-16",
        endDate: "2026-10-16",
        priority: "LOW",
        status: "OPEN",
      },
    ],
    preferences: [
      {
        id: "p",
        employeeId: "e1",
        kind: "AVOID_SHIFT_TYPE",
        shiftTypeId: "S",
        weekday: 5,
        category: null,
        date: null,
        validFrom: null,
        validUntil: null,
        comment: null,
        active: true,
      },
    ],
  });
  const result = validateChanges(snap, [create("n", "e1", "S", "2026-10-16")]);
  assert.equal(result.find((v) => v.code === "OPEN_TIME_OFF_IGNORED")?.severity, "INFO");
  assert.equal(
    result.find((v) => v.code === "PREFERENCE_IGNORED")?.message,
    "Dienstwunsch von Anna Müller „kein Spätdienst am Freitag“ nicht berücksichtigt.",
  );
});

test("Analyse eines Monats meldet Unterbesetzung, Mindestqualifikation und Soll-Abweichung", () => {
  const snap = snapshot({
    staffing: [
      {
        id: "r",
        unitId: UNIT,
        shiftTypeId: "N",
        weekday: null,
        date: "2026-10-14",
        minCount: 1,
        maxCount: 2,
        minQualified: 1,
        qualificationId: "q-hf",
      },
    ],
    shifts: [shift({ id: "a", employeeId: "e1", shiftTypeId: "F", date: "2026-10-14" })],
  });
  const result = analyzeSchedule(snap, 2026, 10);
  assert.ok(result.some((v) => v.code === "MIN_STAFFING" && v.date === "2026-10-14"));
  assert.equal(
    result.find((v) => v.code === "MIN_QUALIFIED")?.message,
    "Nachtdienst 14.10.: keine Pflegefachperson HF eingeteilt.",
  );
  assert.ok(result.some((v) => v.code === "TARGET_DEVIATION" && v.employeeId === "e1"));
});
