import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Row } from "@/lib/api-context";
import { iso } from "@/lib/api-context";
import {
  ANALYSIS_SCHEMA,
  AiOutputError,
  PLANNING_SCHEMA,
  actionToChange,
  buildPlanningInput,
  correctionFeedback,
  distributionFacts,
  parseAnalysisOutput,
  parsePlanningOutput,
  planningSummary,
  pseudonymousFindings,
  pseudonyms,
  restoreNames,
  validateAssignments,
  type AssignmentResult,
  type PlanningRange,
  type SuggestedAction,
} from "./ai-core";
import { MistralError, mistralConfigured, mistralJson, mistralModel } from "@/lib/mistral";
import { auditQuery } from "./audit";
import type { RosterContext } from "./context";
import { requirePermission } from "./context";
import { ensurePeriod, loadRuleSet, loadSnapshot, monthRange } from "./data";
import { RosterError, invalid, notFound } from "./errors";
import { analyzeSchedule, validateChanges } from "./rules";
import { acknowledgement, bool, date, month, uuid, type Body } from "./schemas";
import { commitChanges } from "./shift-service";
import { addDays, weekStart } from "./time";
import type { ScheduleSnapshot, ShiftChange, Violation } from "./types";

// KI-Planung und -Analyse mit Mistral (Spec 9). Der Key bleibt serverseitig; ohne Key ist die
// Funktion mit klarer Meldung deaktiviert. Prompt-Inhalte werden nicht geloggt.

export type ModelCall = (request: {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
}) => Promise<string>;

const MODEL = mistralModel;
export const aiConfigured = mistralConfigured;

// Standard: offizielles Mistral-SDK mit JSON-Schema-Ausgabe. Tests setzen ein Test-Double.
let modelCall: ModelCall = async ({ system, user, schema }) => {
  try {
    return await mistralJson({ system, user, schema });
  } catch (error) {
    if (error instanceof MistralError) throw new AiOutputError(error.message);
    throw error;
  }
};
export const setModelCall = (call: ModelCall) => {
  modelCall = call;
};

const PLANNING_SYSTEM = `Du planst Dienste für eine Wohngruppe eines Pflegeheims in der Schweiz.
Personen sind pseudonymisiert (E1, E2, …). Verwende nur diese Kürzel und nur die angegebenen Diensttyp-Codes.
Harte Regeln: keine Einteilung an "nichtVerfuegbar"-Tagen, ausgeschlossene Kategorien beachten, Qualifikationen der Diensttypen,
Mindestruhezeit zwischen Diensten, maximale Tages- und Wochenarbeitszeit, maximale Arbeitstage am Stück.
Ziele: Mindestbesetzung je Tag und Diensttyp erfüllen, Sollzeit je Person (pensumProzent) annähern, offenes Wunschfrei und
Wünsche nach Möglichkeit berücksichtigen, Nacht- und Wochenenddienste fair verteilen.
Plane nur Tage im angegebenen Zeitraum. Bestehende Dienste bleiben bestehen; plane nicht doppelt.
Antworte ausschliesslich im verlangten JSON-Format. Notizen kurz, sachlich, auf Deutsch (Schweizer Rechtschreibung).`;

const ANALYSIS_SYSTEM = `Du berätst die Leitung einer Wohngruppe eines Pflegeheims bei der Verbesserung eines Dienstplans.
Du bekommst ausschliesslich berechnete Befunde (mit id) und Kennzahlen; Personen sind pseudonymisiert (E1, E2, …).
Erfinde keine Befunde: jeder Vorschlag muss sich mit findingIds auf gelieferte Befunde stützen.
Priorisiere (HIGH/MEDIUM/LOW), begründe kurz und schlage wo möglich konkrete Aktionen vor:
assign (Person, Datum, Code), move (Dienst von Person/Datum zu targetEmployeeRef/targetDate), swap (Dienst von Person/Datum mit targetEmployeeRef am selben Tag).
Nicht benötigte Felder setzt du auf null. Antworte ausschliesslich im verlangten JSON-Format, auf Deutsch (Schweizer Rechtschreibung).`;

export type RunView = {
  id: string;
  kind: "GENERATE" | "OPTIMIZE";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  model: string;
  createdAt: string;
  appliedAt: string | null;
  error: string | null;
  range: PlanningRange | null;
  keepExisting: boolean;
  assignments: Array<AssignmentResult & { name: string; typeName: string; existing: boolean }>;
  notes: Array<{ date: string | null; text: string }>;
  summary: ReturnType<typeof planningSummary> | null;
  suggestions: Array<{
    priority: string;
    title: string;
    reasoning: string;
    findings: string[];
    actions: Array<{ key: string; label: string; valid: boolean; reason: string | null; action?: SuggestedAction }>;
  }>;
};

async function loadRun(ctx: RosterContext, runId: string) {
  const rows = (await ctx.sql`
    SELECT * FROM carecore_ai_planning_runs WHERE id = ${runId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw notFound("KI-Lauf");
  requirePermission(ctx, "ki:use", String(rows[0].care_unit_id));
  return rows[0];
}

export function runView(row: Row): RunView {
  const result = (row.result ?? {}) as Partial<RunView> & { suggestions?: RunView["suggestions"] };
  const options = (row.options ?? {}) as { from?: string; to?: string; keepExisting?: boolean };
  return {
    id: String(row.id),
    kind: row.kind as RunView["kind"],
    status: row.status as RunView["status"],
    model: String(row.model),
    createdAt: iso(row.created_at) ?? "",
    appliedAt: iso(row.applied_at),
    error: row.error ? String(row.error) : null,
    range: options.from && options.to ? { from: options.from, to: options.to } : null,
    keepExisting: options.keepExisting !== false,
    assignments: result.assignments ?? [],
    notes: result.notes ?? [],
    summary: result.summary ?? null,
    suggestions: result.suggestions ?? [],
  };
}

export async function getRun(ctx: RosterContext, runId: string) {
  return runView(await loadRun(ctx, uuid(runId, "KI-Lauf")));
}

// Legt einen Lauf an (Rate-Limit pro Person) und gibt die Ausführung für after() zurück.
export async function startRun(ctx: RosterContext, body: Body) {
  if (!aiConfigured())
    throw new RosterError(
      "AI_UNAVAILABLE",
      "Die KI-Planung ist nicht eingerichtet (MISTRAL_API_KEY fehlt). Alle anderen Funktionen stehen zur Verfügung.",
      503,
    );
  const unitId = uuid(body.unitId, "Wohnbereich");
  requirePermission(ctx, "ki:use", unitId);
  const kind = body.kind === "OPTIMIZE" ? "OPTIMIZE" : "GENERATE";
  const selected = month(body.month);
  const { from: monthFrom, to: monthTo } = monthRange(selected.year, selected.month);
  const from = body.from ? date(body.from, "Von") : monthFrom;
  const to = body.to ? date(body.to, "Bis") : monthTo;
  if (from < monthFrom || to > monthTo || to < from) throw invalid("Der Zeitraum muss im gewählten Monat liegen.");
  const keepExisting = body.keepExisting === undefined ? true : bool(body.keepExisting);
  const period = await ensurePeriod(ctx, unitId, selected.year, selected.month);
  if (kind === "GENERATE" && period.status !== "DRAFT")
    throw invalid("Die KI plant nur Entwürfe. Bitte den Monat zuerst zum Entwurf zurücksetzen.");
  if (period.lockedAt) throw invalid("Der Monat ist abgeschlossen.");
  const rules = await loadRuleSet(ctx, unitId);
  const recent = (await ctx.sql`
    SELECT COUNT(*)::int AS n FROM carecore_ai_planning_runs
    WHERE requested_by = ${ctx.actor.id} AND created_at > NOW() - INTERVAL '1 hour'`) as Row[];
  if (Number(recent[0]?.n ?? 0) >= rules.aiRunsPerHour)
    throw new RosterError(
      "RATE_LIMITED",
      `Höchstens ${rules.aiRunsPerHour} KI-Läufe pro Stunde. Bitte später erneut versuchen.`,
      429,
    );
  const id = randomUUID();
  const options = { from, to, keepExisting, year: selected.year, month: selected.month };
  await ctx.sql`
    INSERT INTO carecore_ai_planning_runs (id, organization_id, care_unit_id, period_id, kind, status, model, input_hash, options, requested_by)
    VALUES (${id}, ${ctx.actor.organizationId}, ${unitId}, ${period.id}, ${kind}, 'PENDING', ${MODEL()}, ${"0".repeat(64)},
      ${JSON.stringify(options)}::jsonb, ${ctx.actor.id})`;
  return { id, execute: () => executeRun(ctx, id) };
}

const names = (snapshot: ScheduleSnapshot) =>
  Object.fromEntries(Object.values(snapshot.employees).map((e) => [e.id, e.name]));

export async function executeRun(ctx: RosterContext, runId: string) {
  const row = await loadRun(ctx, runId);
  const options = row.options as { from: string; to: string; keepExisting: boolean; year: number; month: number };
  const unitId = String(row.care_unit_id);
  await ctx.sql`UPDATE carecore_ai_planning_runs SET status = 'RUNNING', updated_at = NOW() WHERE id = ${runId}`;
  try {
    const { from, to } = monthRange(options.year, options.month);
    const snapshot = await loadSnapshot(ctx, { unitId, from, to });
    const members = Object.values(snapshot.employees)
      .filter((e) => e.unitIds.includes(unitId))
      .map((e) => e.id);
    const refs = pseudonyms(members);
    const result =
      row.kind === "OPTIMIZE" ? await optimize(snapshot, refs, options) : await generate(snapshot, refs, options);
    await ctx.sql`
      UPDATE carecore_ai_planning_runs SET status = 'SUCCEEDED', input_hash = ${result.inputHash}, result = ${JSON.stringify(result.view)}::jsonb,
        violations = ${JSON.stringify(result.violations)}::jsonb, updated_at = NOW()
      WHERE id = ${runId}`;
  } catch (error) {
    const message =
      error instanceof AiOutputError || error instanceof RosterError
        ? error.message
        : "Die KI-Anfrage ist fehlgeschlagen. Bitte später erneut versuchen.";
    // Keine Prompt-Inhalte im Log.
    console.error("[dienstplan] KI-Lauf fehlgeschlagen", error instanceof Error ? error.name : "unknown");
    await ctx.sql`UPDATE carecore_ai_planning_runs SET status = 'FAILED', error = ${message}, updated_at = NOW() WHERE id = ${runId}`;
  }
}

async function generate(
  snapshot: ScheduleSnapshot,
  refs: ReturnType<typeof pseudonyms>,
  options: { from: string; to: string; keepExisting: boolean; year: number; month: number },
) {
  const range = { from: options.from, to: options.to };
  // Ohne "bestehende behalten" werden Arbeitsdienste des Zeitraums (ohne Zeiteintrag) ersetzt.
  const replaced = options.keepExisting
    ? []
    : snapshot.shifts.filter(
        (s) =>
          s.unitId === snapshot.unitId &&
          s.category !== "ABSENCE" &&
          !s.hasTimeEntry &&
          s.date >= range.from &&
          s.date <= range.to,
      );
  let current: ScheduleSnapshot = { ...snapshot, shifts: snapshot.shifts.filter((s) => !replaced.includes(s)) };
  const all: AssignmentResult[] = [];
  const notes: Array<{ date: string | null; text: string }> = [];
  const hashes: string[] = [];
  // Wochenweise planen, damit Ausgaben klein und prüfbar bleiben.
  for (let week = weekStart(range.from); week <= range.to; week = addDays(week, 7)) {
    const part = {
      from: week < range.from ? range.from : week,
      to: addDays(week, 6) > range.to ? range.to : addDays(week, 6),
    };
    const input = buildPlanningInput(current, part, refs, { keepExisting: true });
    hashes.push(createHash("sha256").update(JSON.stringify(input)).digest("hex"));
    let output = parsePlanningOutput(
      await modelCall({
        system: PLANNING_SYSTEM,
        user: JSON.stringify(input),
        schemaName: "dienstplan_woche",
        schema: PLANNING_SCHEMA,
      }),
    );
    let checked = validateAssignments(current, output.assignments, refs, part, randomUUID);
    // Eine Korrekturrunde mit den Verstössen als Rückmeldung (max. 2 Runden).
    const feedback = correctionFeedback(checked.results);
    if (feedback.length) {
      const retry = parsePlanningOutput(
        await modelCall({
          system: PLANNING_SYSTEM,
          user: JSON.stringify({
            ...input,
            bereitsGeprueft: checked.results
              .filter((r) => r.status === "valid")
              .map(({ employeeRef, date, shiftTypeCode }) => ({ employeeRef, date, shiftTypeCode })),
            abgelehnt: feedback,
            auftrag: "Ersetze nur die abgelehnten Zuweisungen durch regelkonforme.",
          }),
          schemaName: "dienstplan_korrektur",
          schema: PLANNING_SCHEMA,
        }),
      );
      const second = validateAssignments(checked.snapshot, retry.assignments, refs, part, randomUUID);
      checked = {
        results: [...checked.results, ...second.results],
        snapshot: second.snapshot,
        changes: [...checked.changes, ...second.changes],
      };
      output = { assignments: output.assignments, notes: [...output.notes, ...retry.notes] };
    }
    all.push(...checked.results);
    notes.push(...output.notes);
    current = checked.snapshot;
  }
  const nameMap = names(snapshot);
  const typeName = (id: string | null) => (id ? (snapshot.shiftTypes[id]?.name ?? "") : "");
  const view: Partial<RunView> = {
    assignments: [
      ...replaced.map((s) => ({
        employeeRef: refs.toRef.get(s.employeeId) ?? "",
        date: s.date,
        shiftTypeCode: snapshot.shiftTypes[s.shiftTypeId]?.code ?? "",
        employeeId: s.employeeId,
        shiftTypeId: s.shiftTypeId,
        status: "discarded" as const,
        reason: "Wird durch den KI-Vorschlag ersetzt.",
        violations: [],
        name: nameMap[s.employeeId] ?? "",
        typeName: typeName(s.shiftTypeId),
        existing: true,
      })),
      ...all.map((a) => ({
        ...a,
        reason: a.reason ? restoreNames(a.reason, refs, nameMap) : null,
        name: a.employeeId ? (nameMap[a.employeeId] ?? a.employeeRef) : a.employeeRef,
        typeName: typeName(a.shiftTypeId),
        existing: false,
      })),
    ],
    notes: notes.map((n) => ({ date: n.date, text: restoreNames(n.text, refs, nameMap) })),
    summary: planningSummary(current, range, options.year, options.month),
  };
  return {
    inputHash: createHash("sha256").update(hashes.join(":")).digest("hex"),
    view,
    violations: all.flatMap((a) => a.violations),
  };
}

async function optimize(
  snapshot: ScheduleSnapshot,
  refs: ReturnType<typeof pseudonyms>,
  options: { year: number; month: number },
) {
  const violations = analyzeSchedule(snapshot, options.year, options.month);
  const findings = pseudonymousFindings(snapshot, violations, refs);
  const input = { befunde: findings, verteilung: distributionFacts(snapshot, refs, options.year, options.month) };
  const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const suggestions = findings.length
    ? parseAnalysisOutput(
        await modelCall({
          system: ANALYSIS_SYSTEM,
          user: JSON.stringify(input),
          schemaName: "dienstplan_analyse",
          schema: ANALYSIS_SCHEMA,
        }),
        findings,
      )
    : [];
  const nameMap = names(snapshot);
  const view: Partial<RunView> = {
    suggestions: suggestions.map((suggestion, index) => ({
      priority: suggestion.priority,
      title: restoreNames(suggestion.title, refs, nameMap),
      reasoning: restoreNames(suggestion.reasoning, refs, nameMap),
      findings: suggestion.findingIds.map((id) => violations[id - 1]?.message).filter(Boolean),
      actions: suggestion.actions.map((action, actionIndex) => {
        const { change, reason } = actionToChange(snapshot, action, refs, randomUUID);
        const checked = change ? validateChanges(snapshot, [change]) : [];
        const block = checked.find((v) => v.severity === "BLOCK");
        const who = restoreNames(action.employeeRef, refs, nameMap);
        const target = action.targetEmployeeRef ? restoreNames(action.targetEmployeeRef, refs, nameMap) : "";
        const label =
          action.kind === "assign"
            ? `${who}: ${action.shiftTypeCode} am ${action.date.slice(8)}.${action.date.slice(5, 7)}. einplanen`
            : action.kind === "move"
              ? `Dienst von ${who} am ${action.date.slice(8)}.${action.date.slice(5, 7)}. zu ${target || who}${action.targetDate ? ` am ${action.targetDate.slice(8)}.${action.targetDate.slice(5, 7)}.` : ""} verschieben`
              : `Dienst von ${who} am ${action.date.slice(8)}.${action.date.slice(5, 7)}. mit ${target} tauschen`;
        return {
          key: `${index}:${actionIndex}`,
          label,
          valid: !!change && !block,
          reason: reason ?? (block ? restoreNames(block.message, refs, nameMap) : null),
          action,
        };
      }),
    })),
  };
  return { inputHash, view, violations };
}

// Übernimmt gültige Zuweisungen (alle oder ausgewählte) als Entwurfsdienste – erneut geprüft, Periode bleibt DRAFT.
export async function applyRun(ctx: RosterContext, runId: string, body: Body) {
  const row = await loadRun(ctx, uuid(runId, "KI-Lauf"));
  if (row.status !== "SUCCEEDED") throw invalid("Der KI-Lauf ist noch nicht abgeschlossen.");
  const view = runView(row);
  const unitId = String(row.care_unit_id);
  const { acknowledged, reason } = acknowledgement(body);
  const periodRows = (await ctx.sql`SELECT status FROM carecore_schedule_periods WHERE id = ${row.period_id}`) as Row[];
  if (periodRows[0]?.status !== "DRAFT" && view.kind === "GENERATE")
    throw invalid("Der Monat ist inzwischen veröffentlicht. KI-Vorschläge werden nur in Entwürfe übernommen.");

  let changes: ShiftChange[] = [];
  if (view.kind === "GENERATE") {
    if (view.appliedAt) throw invalid("Dieser Vorschlag wurde bereits übernommen.");
    const selected = Array.isArray(body.indexes) ? new Set(body.indexes.map(Number)) : null;
    const assignments = view.assignments.filter(
      (a, index) => !a.existing && a.status === "valid" && (!selected || selected.has(index)),
    );
    if (!assignments.length) throw invalid("Keine gültigen Zuweisungen ausgewählt.");
    if (!view.keepExisting && view.range) {
      const { from, to } = view.range;
      const snapshot = await loadSnapshot(ctx, { unitId, from, to });
      changes = snapshot.shifts
        .filter(
          (s) => s.unitId === unitId && s.category !== "ABSENCE" && !s.hasTimeEntry && s.date >= from && s.date <= to,
        )
        .map((s) => ({ kind: "delete" as const, shiftId: s.id, expectedVersion: s.version }));
    }
    changes.push(
      ...assignments.map((a) => ({
        kind: "create" as const,
        shift: { id: randomUUID(), unitId, employeeId: a.employeeId!, shiftTypeId: a.shiftTypeId!, date: a.date },
      })),
    );
  } else {
    const key = String(body.actionKey ?? "");
    const suggestion = view.suggestions[Number(key.split(":")[0])];
    const action = suggestion?.actions.find((a) => a.key === key);
    if (!action?.action) throw notFound("Vorschlag");
    const opts = row.options as { year: number; month: number };
    const snapshot = await loadSnapshot(ctx, { unitId, ...monthRange(opts.year, opts.month) });
    const refs = pseudonyms(
      Object.values(snapshot.employees)
        .filter((e) => e.unitIds.includes(unitId))
        .map((e) => e.id),
    );
    const { change, reason: why } = actionToChange(snapshot, action.action, refs, randomUUID);
    if (!change) throw invalid(why ?? "Der Vorschlag ist nicht mehr anwendbar.");
    changes = [change];
  }
  const result = await commitChanges(ctx, {
    unitId,
    changes,
    acknowledged,
    reason,
    source: "AI",
    auditSource: "AI",
    notify: view.kind !== "GENERATE",
    extra: () =>
      view.kind === "GENERATE"
        ? [
            ctx.sql`UPDATE carecore_ai_planning_runs SET applied_at = NOW(), applied_by = ${ctx.actor.id}, updated_at = NOW() WHERE id = ${row.id}`,
            auditQuery(ctx, {
              action: "ai_applied",
              entityType: "ai_run",
              entityId: String(row.id),
              unitId,
              after: {
                shifts: changes.filter((c) => c.kind === "create").length,
                replaced: changes.filter((c) => c.kind === "delete").length,
              },
              source: "AI",
            }),
          ]
        : [],
  });
  return { ...result, violations: result.violations as Violation[] };
}
