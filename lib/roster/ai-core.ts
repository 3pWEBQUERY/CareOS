// KI-Planung (Spec Abschnitt 9) – reiner Kern ohne Netz und Datenbank:
// pseudonymisierte Eingabe, Prüfung der Ausgabe, Validierung jeder Zuweisung durch die Regel-Engine.
// Fakten berechnet der Code; die KI schlägt vor und erklärt.
import { analyzeSchedule, applyChanges, blocking, isNightShift, validateChanges } from "./rules";
import { addDays, DATE_PATTERN, isWeekend, weekday } from "./time";
import type { RosterShift, ScheduleSnapshot, ShiftChange, Violation } from "./types";
import { dailyTargetMinutes } from "./worktime";

export type Pseudonyms = { toRef: Map<string, string>; toId: Map<string, string> };

// E1, E2, … in stabiler Reihenfolge (nach ID), ohne Namen.
export function pseudonyms(employeeIds: string[]): Pseudonyms {
  const sorted = [...employeeIds].sort();
  return {
    toRef: new Map(sorted.map((id, index) => [id, `E${index + 1}`])),
    toId: new Map(sorted.map((id, index) => [`E${index + 1}`, id])),
  };
}

export type PlanningRange = { from: string; to: string };

const datesIn = (range: PlanningRange) => {
  const days: string[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) days.push(day);
  return days;
};

// Eingabe für die Planung – ausschliesslich Pseudonyme, Codes und Zahlen; keine Namen, keine
// Abwesenheitsgründe, keine Freitexte.
export function buildPlanningInput(
  snapshot: ScheduleSnapshot,
  range: PlanningRange,
  refs: Pseudonyms,
  options: { keepExisting: boolean },
) {
  const unitId = snapshot.unitId;
  const types = Object.values(snapshot.shiftTypes).filter(
    (type) => type.active && type.category !== "ABSENCE" && (!type.careUnitId || type.careUnitId === unitId),
  );
  const qualificationCode = (id: string) => `Q${Object.keys(snapshot.qualificationNames).sort().indexOf(id) + 1}`;
  const days = datesIn(range);
  const members = Object.values(snapshot.employees).filter(
    (employee) => employee.active && employee.unitIds.includes(unitId) && refs.toRef.has(employee.id),
  );
  const approvedOff = (employeeId: string) =>
    snapshot.timeOff
      .filter((t) => t.employeeId === employeeId && t.status === "APPROVED")
      .flatMap((t) => datesIn({ from: t.startDate, to: t.endDate }))
      .filter((day) => day >= range.from && day <= range.to);
  const absent = (employeeId: string) =>
    snapshot.shifts
      .filter(
        (s) => s.employeeId === employeeId && s.category === "ABSENCE" && s.date >= range.from && s.date <= range.to,
      )
      .map((s) => s.date);
  const existing = snapshot.shifts.filter(
    (s) =>
      refs.toRef.has(s.employeeId) &&
      s.category !== "ABSENCE" &&
      (options.keepExisting || s.date < range.from || s.date > range.to || s.hasTimeEntry),
  );
  return {
    zeitraum: range,
    feiertage: snapshot.holidays.filter((day) => day >= range.from && day <= range.to),
    regeln: {
      minRuhezeitMinuten: snapshot.ruleSet.minRestMinutes,
      maxTagesarbeitMinuten: snapshot.ruleSet.maxDailyWorkMinutes,
      maxWochenarbeitMinuten: snapshot.ruleSet.maxWeeklyWorkMinutes,
      maxArbeitstageAmStueck: snapshot.ruleSet.maxConsecutiveWorkDays,
    },
    diensttypen: types.map((type) => ({
      code: type.code,
      kategorie: type.category,
      beginn: type.startTime,
      ende: type.endTime,
      pauseMinuten: type.breakMinutes,
      qualifikationen: type.requiredQualificationIds.map(qualificationCode),
    })),
    mindestbesetzung: days.flatMap((day) =>
      types.flatMap((type) => {
        const matching = snapshot.staffing.filter((r) => r.unitId === unitId && r.shiftTypeId === type.id);
        const requirement =
          matching.find((r) => r.date === day) ?? matching.find((r) => !r.date && r.weekday === weekday(day));
        return requirement
          ? [
              {
                datum: day,
                code: type.code,
                min: requirement.minCount,
                max: requirement.maxCount,
                minQualifiziert: requirement.minQualified,
                qualifikation: requirement.qualificationId ? qualificationCode(requirement.qualificationId) : null,
              },
            ]
          : [];
      }),
    ),
    personen: members
      .sort((a, b) => refs.toRef.get(a.id)!.localeCompare(refs.toRef.get(b.id)!, "en", { numeric: true }))
      .map((employee) => ({
        ref: refs.toRef.get(employee.id)!,
        pensumProzent: employee.pensumPercent,
        sollMinutenProWerktag: dailyTargetMinutes(snapshot.ruleSet.weeklyNormMinutes, employee),
        qualifikationen: employee.qualifications
          .filter((q) => q.validFrom <= range.to && (!q.validUntil || q.validUntil >= range.from))
          .map((q) => qualificationCode(q.qualificationId)),
        ausgeschlossen: employee.excludedCategories,
        nichtVerfuegbar: [...new Set([...absent(employee.id), ...approvedOff(employee.id)])].sort(),
        wunschfreiOffen: snapshot.timeOff
          .filter((t) => t.employeeId === employee.id && t.status === "OPEN")
          .flatMap((t) => datesIn({ from: t.startDate, to: t.endDate }))
          .filter((day) => day >= range.from && day <= range.to),
        wuensche: snapshot.preferences
          .filter((p) => p.employeeId === employee.id && p.active)
          .map((p) => ({
            art: p.kind,
            code: p.shiftTypeId ? (snapshot.shiftTypes[p.shiftTypeId]?.code ?? null) : null,
            wochentag: p.weekday,
            kategorie: p.category,
            datum: p.date,
          })),
      })),
    bestehendeDienste: existing
      .filter((s) => s.date >= addDays(range.from, -2) && s.date <= addDays(range.to, 1))
      .map((s) => ({
        ref: refs.toRef.get(s.employeeId)!,
        datum: s.date,
        code: snapshot.shiftTypes[s.shiftTypeId]?.code ?? "?",
      })),
  };
}

export const PLANNING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignments", "notes"],
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["employeeRef", "date", "shiftTypeCode"],
        properties: {
          employeeRef: { type: "string" },
          date: { type: "string" },
          shiftTypeCode: { type: "string" },
        },
      },
    },
    notes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "text"],
        properties: { date: { type: ["string", "null"] }, text: { type: "string" } },
      },
    },
  },
} as const;

export type Assignment = { employeeRef: string; date: string; shiftTypeCode: string };
export type AssignmentResult = Assignment & {
  employeeId: string | null;
  shiftTypeId: string | null;
  status: "valid" | "discarded";
  reason: string | null;
  violations: Violation[];
};

export class AiOutputError extends Error {}

// Prüft die Form der Antwort (statt Zod): ungültiges JSON und falsches Schema sind Fehler.
export function parsePlanningOutput(text: string): {
  assignments: Assignment[];
  notes: Array<{ date: string | null; text: string }>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiOutputError("Die KI hat kein gültiges JSON geliefert.");
  }
  const value = parsed as { assignments?: unknown; notes?: unknown };
  if (!value || typeof value !== "object" || !Array.isArray(value.assignments))
    throw new AiOutputError("Die Antwort der KI hat nicht das erwartete Format (assignments fehlt).");
  const assignments = value.assignments.map((item, index) => {
    const a = item as Record<string, unknown>;
    if (!a || typeof a.employeeRef !== "string" || typeof a.date !== "string" || typeof a.shiftTypeCode !== "string")
      throw new AiOutputError(`Zuweisung ${index + 1} der KI ist unvollständig.`);
    return {
      employeeRef: a.employeeRef.trim(),
      date: a.date.trim(),
      shiftTypeCode: a.shiftTypeCode.trim().toUpperCase(),
    };
  });
  const notes = Array.isArray(value.notes)
    ? value.notes
        .map((item) => item as Record<string, unknown>)
        .filter((n) => n && typeof n.text === "string")
        .map((n) => ({
          date: typeof n.date === "string" && DATE_PATTERN.test(n.date) ? n.date : null,
          text: String(n.text).slice(0, 500),
        }))
    : [];
  return { assignments, notes };
}

// Jede Zuweisung einzeln durch die Regel-Engine – in Reihenfolge, auf dem Plan inklusive der bereits
// akzeptierten Zuweisungen. Ungültige werden mit Grund verworfen, nie still übernommen.
export function validateAssignments(
  snapshot: ScheduleSnapshot,
  assignments: Assignment[],
  refs: Pseudonyms,
  range: PlanningRange,
  newId: () => string,
): { results: AssignmentResult[]; snapshot: ScheduleSnapshot; changes: ShiftChange[] } {
  const types = Object.values(snapshot.shiftTypes).filter(
    (type) => type.active && type.category !== "ABSENCE" && (!type.careUnitId || type.careUnitId === snapshot.unitId),
  );
  let current = snapshot;
  const changes: ShiftChange[] = [];
  const results: AssignmentResult[] = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const employeeId = refs.toId.get(assignment.employeeRef) ?? null;
    const type = types.find((t) => t.code === assignment.shiftTypeCode) ?? null;
    const discard = (reason: string, violations: Violation[] = []) =>
      results.push({
        ...assignment,
        employeeId,
        shiftTypeId: type?.id ?? null,
        status: "discarded",
        reason,
        violations,
      });
    if (!employeeId) {
      discard(`Unbekannte Person „${assignment.employeeRef}“.`);
      continue;
    }
    if (!DATE_PATTERN.test(assignment.date) || assignment.date < range.from || assignment.date > range.to) {
      discard(`Ungültiges Datum „${assignment.date}“ (ausserhalb ${range.from}–${range.to}).`);
      continue;
    }
    if (!type) {
      discard(`Unbekannter Diensttyp „${assignment.shiftTypeCode}“.`);
      continue;
    }
    const key = `${employeeId}|${assignment.date}`;
    if (seen.has(key)) {
      discard("Doppelte Zuweisung für dieselbe Person am selben Tag.");
      continue;
    }
    const change: ShiftChange = {
      kind: "create",
      shift: { id: newId(), unitId: snapshot.unitId, employeeId, shiftTypeId: type.id, date: assignment.date },
    };
    const violations = validateChanges(current, [change]);
    const blocks = blocking(violations);
    if (blocks.length) {
      discard(blocks[0].message, violations);
      continue;
    }
    seen.add(key);
    changes.push(change);
    current = { ...current, shifts: applyChanges(current, [change]).shifts };
    results.push({ ...assignment, employeeId, shiftTypeId: type.id, status: "valid", reason: null, violations });
  }
  return { results, snapshot: current, changes };
}

// Rückmeldung für die Korrekturrunde: nur Pseudonyme und Regeln, keine Namen.
export function correctionFeedback(results: AssignmentResult[]) {
  return results
    .filter((r) => r.status === "discarded")
    .map((r) => ({
      zuweisung: { employeeRef: r.employeeRef, date: r.date, shiftTypeCode: r.shiftTypeCode },
      regel: r.violations.find((v) => v.severity === "BLOCK")?.code ?? "UNGUELTIG",
    }));
}

// Zusammenfassung der Vorschau: Besetzung je Tag, Soll-Abweichung je Person, Wünsche.
export function planningSummary(snapshot: ScheduleSnapshot, range: PlanningRange, year: number, month: number) {
  const analysis = analyzeSchedule(snapshot, year, month).filter(
    (v) => !v.date || (v.date >= range.from && v.date <= range.to),
  );
  const days = datesIn(range).map((date) => ({
    date,
    staffed: !analysis.some((v) => v.date === date && (v.code === "MIN_STAFFING" || v.code === "MIN_QUALIFIED")),
  }));
  return {
    days,
    targetDeviations: analysis
      .filter((v) => v.code === "TARGET_DEVIATION")
      .map((v) => ({ employeeId: v.employeeId, message: v.message })),
    ignoredPreferences: analysis.filter((v) => v.code === "PREFERENCE_IGNORED").length,
    openTimeOffIgnored: analysis.filter((v) => v.code === "OPEN_TIME_OFF_IGNORED").length,
  };
}

// Namen erst serverseitig nach der Antwort wieder einsetzen (E3 → Name).
export function restoreNames(text: string, refs: Pseudonyms, names: Record<string, string>) {
  return text.replace(/\bE(\d+)\b/g, (match) => {
    const id = refs.toId.get(match);
    return id && names[id] ? names[id] : match;
  });
}

// --- Analyse / Optimierung (Spec 9.3) ----------------------------------------------------------

export type Finding = {
  id: number;
  code: string;
  severity: string;
  date: string | null;
  employeeRef: string | null;
  shiftTypeCode: string | null;
  meta: Record<string, unknown>;
};

// Befunde der deterministischen Analyse in pseudonymisierter Form (ohne Meldungstexte mit Namen).
export function pseudonymousFindings(snapshot: ScheduleSnapshot, violations: Violation[], refs: Pseudonyms): Finding[] {
  return violations.map((violation, index) => {
    const shift = violation.shiftId ? snapshot.shifts.find((s) => s.id === violation.shiftId) : null;
    const typeId = (violation.meta?.shiftTypeId as string | undefined) ?? shift?.shiftTypeId;
    const numbers = Object.fromEntries(
      Object.entries(violation.meta ?? {}).filter(([, value]) => typeof value === "number"),
    );
    return {
      id: index + 1,
      code: violation.code,
      severity: violation.severity,
      date: violation.date ?? null,
      employeeRef: violation.employeeId ? (refs.toRef.get(violation.employeeId) ?? null) : null,
      shiftTypeCode: typeId ? (snapshot.shiftTypes[typeId]?.code ?? null) : null,
      meta: numbers,
    };
  });
}

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "title", "reasoning", "findingIds", "actions"],
        properties: {
          priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          title: { type: "string" },
          reasoning: { type: "string" },
          findingIds: { type: "array", items: { type: "integer" } },
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "employeeRef", "date", "shiftTypeCode", "targetEmployeeRef", "targetDate"],
              properties: {
                kind: { type: "string", enum: ["move", "swap", "assign"] },
                employeeRef: { type: "string" },
                date: { type: "string" },
                shiftTypeCode: { type: ["string", "null"] },
                targetEmployeeRef: { type: ["string", "null"] },
                targetDate: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type SuggestedAction = {
  kind: "move" | "swap" | "assign";
  employeeRef: string;
  date: string;
  shiftTypeCode: string | null;
  targetEmployeeRef: string | null;
  targetDate: string | null;
};
export type Suggestion = {
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  reasoning: string;
  findingIds: number[];
  actions: SuggestedAction[];
};

export function parseAnalysisOutput(text: string, findings: Finding[]): Suggestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiOutputError("Die KI hat kein gültiges JSON geliefert.");
  }
  const value = parsed as { suggestions?: unknown };
  if (!value || !Array.isArray(value.suggestions))
    throw new AiOutputError("Die Antwort der KI enthält keine Vorschläge.");
  const known = new Set(findings.map((f) => f.id));
  return (
    value.suggestions
      .map((item) => item as Record<string, unknown>)
      .filter((s) => s && typeof s.title === "string" && typeof s.reasoning === "string")
      .map((s) => ({
        priority: (["HIGH", "MEDIUM", "LOW"].includes(String(s.priority))
          ? s.priority
          : "MEDIUM") as Suggestion["priority"],
        title: String(s.title).slice(0, 200),
        reasoning: String(s.reasoning).slice(0, 1000),
        findingIds: Array.isArray(s.findingIds) ? s.findingIds.map(Number).filter((id) => known.has(id)) : [],
        actions: Array.isArray(s.actions)
          ? s.actions
              .map((a) => a as Record<string, unknown>)
              .filter(
                (a) =>
                  a &&
                  ["move", "swap", "assign"].includes(String(a.kind)) &&
                  typeof a.employeeRef === "string" &&
                  typeof a.date === "string",
              )
              .map((a) => ({
                kind: a.kind as SuggestedAction["kind"],
                employeeRef: String(a.employeeRef),
                date: String(a.date),
                shiftTypeCode: typeof a.shiftTypeCode === "string" ? a.shiftTypeCode.toUpperCase() : null,
                targetEmployeeRef: typeof a.targetEmployeeRef === "string" ? a.targetEmployeeRef : null,
                targetDate: typeof a.targetDate === "string" ? a.targetDate : null,
              }))
          : [],
      }))
      // Die KI darf keine Befunde erfinden: jeder Vorschlag muss sich auf berechnete Befunde stützen.
      .filter((s) => s.findingIds.length > 0)
  );
}

// Übersetzt eine vorgeschlagene Aktion in eine Änderung für die Regel-Engine.
export function actionToChange(
  snapshot: ScheduleSnapshot,
  action: SuggestedAction,
  refs: Pseudonyms,
  newId: () => string,
): { change: ShiftChange | null; reason: string | null } {
  const employeeId = refs.toId.get(action.employeeRef);
  if (!employeeId) return { change: null, reason: `Unbekannte Person „${action.employeeRef}“.` };
  const typeId = action.shiftTypeCode
    ? Object.values(snapshot.shiftTypes).find((t) => t.code === action.shiftTypeCode)?.id
    : undefined;
  const shiftOf = (id: string, date: string, withType: boolean): RosterShift | undefined =>
    snapshot.shifts.find(
      (s) =>
        s.employeeId === id &&
        s.date === date &&
        s.unitId === snapshot.unitId &&
        s.category !== "ABSENCE" &&
        (!withType || !typeId || s.shiftTypeId === typeId),
    );
  if (action.kind === "assign") {
    if (!typeId) return { change: null, reason: "Diensttyp fehlt oder ist unbekannt." };
    return {
      change: {
        kind: "create",
        shift: { id: newId(), unitId: snapshot.unitId, employeeId, shiftTypeId: typeId, date: action.date },
      },
      reason: null,
    };
  }
  const source = shiftOf(employeeId, action.date, true);
  if (!source) return { change: null, reason: "Der genannte Dienst existiert nicht." };
  const targetId = action.targetEmployeeRef ? refs.toId.get(action.targetEmployeeRef) : employeeId;
  if (!targetId) return { change: null, reason: `Unbekannte Person „${action.targetEmployeeRef}“.` };
  if (action.kind === "move")
    return {
      change: {
        kind: "move",
        shiftId: source.id,
        expectedVersion: source.version,
        employeeId: targetId,
        date: action.targetDate ?? action.date,
      },
      reason: null,
    };
  const target = shiftOf(targetId, action.targetDate ?? action.date, false);
  return {
    change: {
      kind: "swap",
      sourceShiftId: source.id,
      sourceVersion: source.version,
      targetEmployeeId: targetId,
      targetShiftId: target?.id ?? null,
      targetVersion: target?.version ?? null,
    },
    reason: null,
  };
}

// Kennzahlen, die die Analyse-KI als Kontext bekommt (Verteilung Nacht/Wochenende je Person).
export function distributionFacts(snapshot: ScheduleSnapshot, refs: Pseudonyms, year: number, month: number) {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const shifts = snapshot.shifts.filter(
    (s) => s.unitId === snapshot.unitId && s.date.startsWith(prefix) && s.category !== "ABSENCE",
  );
  return [...refs.toRef.entries()].map(([id, ref]) => ({
    ref,
    dienste: shifts.filter((s) => s.employeeId === id).length,
    nacht: shifts.filter((s) => s.employeeId === id && isNightShift(s, snapshot)).length,
    wochenende: shifts.filter((s) => s.employeeId === id && isWeekend(s.date)).length,
  }));
}
