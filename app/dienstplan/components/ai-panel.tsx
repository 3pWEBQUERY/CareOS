"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkle } from "@phosphor-icons/react";
import type { RunView } from "@/lib/roster/ai";
import { addDays, formatDate, monthDays, weekStart } from "@/lib/roster/time";
import type { RuleCode, Violation } from "@/lib/roster/types";
import type { SchedulePayload } from "@/lib/roster/view-types";
import { RosterRequestError, rosterRequest } from "./roster-api";
import { SidePanel } from "./side-panel";
import { ViolationList } from "./violation-dialog";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";

type Pending = {
  violations: Violation[];
  retry: (ack: { acknowledgedWarnings: RuleCode[]; overrideReason: string }) => Promise<void>;
};

// KI-Planung und -Analyse (Spec 9): Vorschlag erzeugen, prüfen lassen, Vorschau, übernehmen als Entwurf.
export function AiPlanningPanel({
  data,
  onClose,
  onApplied,
}: {
  data: SchedulePayload;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const monthKey = `${data.year}-${String(data.month).padStart(2, "0")}`;
  const days = monthDays(data.year, data.month);
  const [kind, setKind] = useState<"GENERATE" | "OPTIMIZE">(
    data.period?.status === "PUBLISHED" ? "OPTIMIZE" : "GENERATE",
  );
  const [scope, setScope] = useState<"month" | "week">("month");
  const [week, setWeek] = useState(weekStart(data.days.find((d) => d.today)?.date ?? days[0]));
  const [keepExisting, setKeepExisting] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!runId) return;
    let live = true;
    let timer: number;
    const poll = async () => {
      try {
        const next = await rosterRequest<RunView>(`/api/dienstplan/ai/runs/${runId}`);
        if (!live) return;
        setRun(next);
        if (next.status === "PENDING" || next.status === "RUNNING") timer = window.setTimeout(poll, 2000);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "Status konnte nicht geladen werden.");
      }
    };
    void poll();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [runId]);

  const start = async () => {
    setBusy(true);
    setError("");
    setRun(null);
    setSelected(null);
    try {
      const weekEnd = addDays(week, 6);
      const range =
        scope === "week"
          ? { from: week < days[0] ? days[0] : week, to: weekEnd > days.at(-1)! ? days.at(-1)! : weekEnd }
          : {};
      const result = await rosterRequest<{ id: string }>("/api/dienstplan/ai/runs", {
        method: "POST",
        body: { unitId: data.unit.id, month: monthKey, kind, keepExisting, ...range },
      });
      setRunId(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Start fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (body: Record<string, unknown>, message: string) => {
    if (!run) return;
    setBusy(true);
    setError("");
    const send = async (ack: object) => {
      await rosterRequest(`/api/dienstplan/ai/runs/${run.id}/apply`, { method: "POST", body: { ...body, ...ack } });
      onApplied(message);
    };
    try {
      await send({});
    } catch (cause) {
      if (cause instanceof RosterRequestError && cause.code === "CONFIRMATION_REQUIRED")
        setPending({ violations: cause.violations, retry: send });
      else setError(cause instanceof Error ? cause.message : "Übernehmen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const valid =
    run?.assignments.map((a, index) => ({ a, index })).filter(({ a }) => !a.existing && a.status === "valid") ?? [];
  const discarded = run?.assignments.filter((a) => !a.existing && a.status === "discarded") ?? [];
  const replaced = run?.assignments.filter((a) => a.existing) ?? [];
  const chosen = selected ?? new Set(valid.map(({ index }) => index));
  const range = run?.range;
  const previewDays = useMemo(() => (range ? days.filter((d) => d >= range.from && d <= range.to) : []), [range, days]);
  const running = run && (run.status === "PENDING" || run.status === "RUNNING");

  return (
    <SidePanel
      id="roster-ai"
      eyebrow={`Dienstplan · ${data.unit.name}`}
      title="Mit KI planen"
      description="Die KI schlägt vor, die Regel-Engine prüft jede Zuweisung. Übernommen wird nur in den Entwurf – veröffentlicht wird nie automatisch. An die KI gehen nur pseudonymisierte Daten (keine Namen, keine Gründe)."
      onClose={onClose}
      actions={
        run?.status === "SUCCEEDED" && run.kind === "GENERATE" && !run.appliedAt ? (
          <>
            <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
              Verwerfen
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || chosen.size === 0}
              onClick={() =>
                void apply({ indexes: [...chosen] }, "KI-Vorschlag übernommen – im Raster weiterbearbeiten.")
              }
            >
              Ändern
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={busy || chosen.size === 0}
              onClick={() =>
                void apply(
                  { indexes: [...chosen] },
                  `${chosen.size} Dienste aus dem KI-Vorschlag übernommen (Entwurf).`,
                )
              }
            >
              {busy ? "Übernehmen…" : `Übernehmen (${chosen.size})`}
            </button>
          </>
        ) : (
          <>
            <button className="secondary-button" type="button" onClick={onClose}>
              Schliessen
            </button>
            {!run || run.status === "FAILED" || run.status === "SUCCEEDED" ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => void start()}
                disabled={busy || !data.aiAvailable}
              >
                <Sparkle className="button-icon" />{" "}
                {run ? "Neu starten" : kind === "GENERATE" ? "Vorschlag erstellen" : "Plan analysieren"}
              </button>
            ) : null}
          </>
        )
      }
    >
      {!data.aiAvailable && (
        <p className="roster-alert">
          Die KI-Planung ist nicht eingerichtet: In Railway fehlt <code>MISTRAL_API_KEY</code>. Alle anderen Funktionen
          des Dienstplans stehen zur Verfügung.
        </p>
      )}
      {!run && (
        <div className="area-editor-grid roster-ai-form">
          <fieldset className="area-editor-wide">
            <legend>Was soll die KI tun?</legend>
            <label className="roster-checkbox">
              <input
                type="radio"
                name="ai-kind"
                checked={kind === "GENERATE"}
                onChange={() => setKind("GENERATE")}
                disabled={data.period?.status === "PUBLISHED"}
              />
              <span>Plan erstellen (nur für Entwürfe)</span>
            </label>
            <label className="roster-checkbox">
              <input type="radio" name="ai-kind" checked={kind === "OPTIMIZE"} onChange={() => setKind("OPTIMIZE")} />
              <span>Plan analysieren und Verbesserungen vorschlagen</span>
            </label>
          </fieldset>
          {kind === "GENERATE" && (
            <>
              <label>
                <span>Zeitraum</span>
                <CareOptionSelect
                  label="Zeitraum"
                  value={scope}
                  onChange={(value) => setScope(value as "month" | "week")}
                  options={[
                    { value: "month", label: "Ganzer Monat" },
                    { value: "week", label: "Eine Woche" },
                  ]}
                />
              </label>
              {scope === "week" && (
                <label>
                  <span>Woche ab (Montag)</span>
                  <CareDatePicker
                    label="Woche ab (Montag)"
                    value={week}
                    onChange={(value) => value && setWeek(weekStart(value))}
                  />
                </label>
              )}
              <label className="area-editor-wide roster-checkbox">
                <input
                  type="checkbox"
                  checked={keepExisting}
                  onChange={(event) => setKeepExisting(event.target.checked)}
                />
                <span>
                  Bestehende Dienste behalten (sonst werden Arbeitsdienste im Zeitraum ersetzt; Abwesenheiten bleiben)
                </span>
              </label>
            </>
          )}
        </div>
      )}
      {running && (
        <p className="roster-muted" role="status">
          Die KI arbeitet … (wochenweise, jede Zuweisung wird geprüft). Das kann eine Minute dauern.
        </p>
      )}
      {run?.status === "FAILED" && (
        <p className="appointment-editor-error" role="alert">
          {run.error}
        </p>
      )}
      {run?.status === "SUCCEEDED" && run.kind === "GENERATE" && (
        <>
          {run.appliedAt && <p className="roster-alert">Dieser Vorschlag wurde bereits übernommen.</p>}
          <div className="roster-analysis-summary">
            <span className="ok">
              <strong>{valid.length}</strong> gültige Zuweisungen
            </span>
            <span className={discarded.length ? "attention" : "ok"}>
              <strong>{discarded.length}</strong> verworfen
            </span>
            <span className={run.summary && run.summary.days.some((d) => !d.staffed) ? "attention" : "ok"}>
              <strong>
                {run.summary?.days.filter((d) => d.staffed).length ?? 0}/{run.summary?.days.length ?? 0}
              </strong>{" "}
              Tage besetzt
            </span>
          </div>
          <div className="roster-ai-diff" role="table" aria-label="Vorschau: neu, unverändert, verworfen">
            <div role="row" className="roster-ai-diff-row head">
              <span role="columnheader">Person</span>
              {previewDays.map((day) => (
                <span role="columnheader" key={day}>
                  {Number(day.slice(8))}
                </span>
              ))}
            </div>
            {data.employees.map((employee) => (
              <div role="row" className="roster-ai-diff-row" key={employee.id}>
                <span role="rowheader">{employee.name}</span>
                {previewDays.map((day) => {
                  const added = run.assignments.find(
                    (a) => a.employeeId === employee.id && a.date === day && !a.existing && a.status === "valid",
                  );
                  const dropped = run.assignments.find(
                    (a) => a.employeeId === employee.id && a.date === day && a.status === "discarded",
                  );
                  const kept = data.shifts.find(
                    (s) => s.employeeId === employee.id && s.date === day && !(dropped?.existing ?? false),
                  );
                  return (
                    <span
                      role="cell"
                      key={day}
                      className={added ? "new" : dropped ? "dropped" : kept ? "kept" : ""}
                      title={
                        added
                          ? `Neu: ${added.typeName}`
                          : dropped
                            ? `Verworfen: ${dropped.reason}`
                            : kept
                              ? `Unverändert: ${kept.name}`
                              : "frei"
                      }
                    >
                      {added?.shiftTypeCode ?? dropped?.shiftTypeCode ?? kept?.code ?? ""}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="roster-legend">
            <span>
              <i className="new" /> neu
            </span>
            <span>
              <i className="kept" /> unverändert
            </span>
            <span>
              <i className="dropped" /> verworfen / ersetzt
            </span>
          </p>
          {valid.length > 0 && !run.appliedAt && (
            <section className="roster-panel-section">
              <h3>Neue Zuweisungen</h3>
              <ul className="roster-ai-list">
                {valid.map(({ a, index }) => (
                  <li key={index}>
                    <label className="roster-checkbox">
                      <input
                        type="checkbox"
                        checked={chosen.has(index)}
                        onChange={(event) => {
                          const next = new Set(chosen);
                          if (event.target.checked) next.add(index);
                          else next.delete(index);
                          setSelected(next);
                        }}
                      />
                      <span>
                        {formatDate(a.date)} · {a.name} · {a.shiftTypeCode} {a.typeName}
                        {a.violations.some((v) => v.severity === "WARN") && " ⚠"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {discarded.length > 0 && (
            <section className="roster-panel-section">
              <h3>Verworfen (von der Regel-Engine)</h3>
              <ul className="roster-ai-list">
                {discarded.map((a, index) => (
                  <li key={index} className="dropped">
                    {formatDate(a.date)} · {a.name} · {a.shiftTypeCode}: {a.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {replaced.length > 0 && (
            <p className="roster-muted">
              {replaced.length} bestehende Arbeitsdienste im Zeitraum werden beim Übernehmen ersetzt.
            </p>
          )}
          {run.summary && run.summary.targetDeviations.length > 0 && (
            <section className="roster-panel-section">
              <h3>Soll-Abweichung nach Übernahme</h3>
              <ul className="roster-ai-list">
                {run.summary.targetDeviations.map((t, index) => (
                  <li key={index}>{t.message}</li>
                ))}
              </ul>
            </section>
          )}
          {run.notes.length > 0 && (
            <section className="roster-panel-section">
              <h3>Hinweise der KI</h3>
              <ul className="roster-ai-list">
                {run.notes.map((note, index) => (
                  <li key={index}>
                    {note.date ? `${formatDate(note.date)}: ` : ""}
                    {note.text}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {run?.status === "SUCCEEDED" && run.kind === "OPTIMIZE" && (
        <section className="roster-panel-section">
          <h3>Vorschläge</h3>
          {!run.suggestions.length && (
            <p className="roster-muted">Keine Verbesserungsvorschläge – die Analyse fand nichts Wesentliches.</p>
          )}
          <ol className="roster-suggestions">
            {run.suggestions.map((suggestion, index) => (
              <li key={index}>
                <span className={`roster-priority ${suggestion.priority.toLowerCase()}`}>
                  {suggestion.priority === "HIGH" ? "Hoch" : suggestion.priority === "MEDIUM" ? "Mittel" : "Niedrig"}
                </span>
                <strong>{suggestion.title}</strong>
                <p>{suggestion.reasoning}</p>
                {suggestion.findings.length > 0 && (
                  <ul className="roster-ai-list">
                    {suggestion.findings.map((finding, i) => (
                      <li key={i}>Befund: {finding}</li>
                    ))}
                  </ul>
                )}
                {suggestion.actions.map((action) => (
                  <div className="roster-suggestion-action" key={action.key}>
                    <span>{action.label}</span>
                    {action.valid ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy || !data.canEdit}
                        onClick={() => void apply({ actionKey: action.key }, "Vorschlag angewendet.")}
                      >
                        Anwenden
                      </button>
                    ) : (
                      <em>Nicht anwendbar: {action.reason}</em>
                    )}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </section>
      )}
      {pending && (
        <section className="roster-panel-section">
          <h3>Warnungen bestätigen</h3>
          <ViolationList violations={pending.violations} />
          <label className="roster-reason">
            <span>Begründung (wird protokolliert)</span>
            <textarea rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await pending.retry({
                  acknowledgedWarnings: [
                    ...new Set(pending.violations.filter((v) => v.severity === "WARN").map((v) => v.code)),
                  ],
                  overrideReason: reason.trim(),
                });
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Übernehmen fehlgeschlagen.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Trotzdem übernehmen
          </button>
        </section>
      )}
      {error && (
        <p className="appointment-editor-error" role="alert">
          {error}
        </p>
      )}
    </SidePanel>
  );
}
