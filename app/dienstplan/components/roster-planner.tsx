"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsLeftRight,
  CalendarDots,
  CaretLeft,
  CaretRight,
  ChartBar,
  CheckCircle,
  ClockCountdown,
  CopySimple,
  MagnifyingGlass,
  Plus,
  Printer,
  Sparkle,
  UsersThree,
  Warning,
} from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import { addDays, monthLabel, shiftMonth, weekStart } from "@/lib/roster/time";
import type { RuleCode } from "@/lib/roster/types";
import { revertCells, undoEntry, type UndoEntry } from "@/lib/roster/undo";
import type { CommitResult, GridShift, SchedulePayload } from "@/lib/roster/view-types";
import { AiPlanningPanel } from "./ai-panel";
import { PublishPanel } from "./publish-panel";
import { CopyWeekDialog } from "./copy-week";
import { RosterGrid, type CellValue, type PaintTool } from "./roster-grid";
import { RosterRequestError, rosterRequest, useRosterData } from "./roster-api";
import { MoveDialog, ShiftEditor, type ShiftDraft } from "./shift-editor";
import { ShiftDetail } from "./shift-detail";
import { SidePanel } from "./side-panel";
import { ViolationDialog, type ViolationPrompt } from "./violation-dialog";
import { CareOptionSelect } from "@/app/components/care-form-controls";

type Ack = { acknowledgedWarnings?: RuleCode[]; overrideReason?: string };
type Dialog =
  | { kind: "create"; employeeId: string; date: string }
  | { kind: "edit"; shift: GridShift }
  | { kind: "detail"; shift: GridShift }
  | { kind: "move"; shift: GridShift }
  | { kind: "swap"; source: GridShift; target: GridShift }
  | { kind: "publish" | "analyze" }
  | { kind: "ai" }
  | { kind: "copy-week" };

type History = { key: string; undo: UndoEntry[]; redo: UndoEntry[] };
const HISTORY_LIMIT = 50;
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

// Strg+Z / Strg+Y (bzw. Strg+Umschalt+Z, auf dem Mac ⌘) für die Planung; Textfelder behalten ihr eigenes Rückgängig.
function UndoKeys({ enabled, onUndo, onRedo }: { enabled: boolean; onUndo: () => void; onRedo: () => void }) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        onUndo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onUndo, onRedo]);
  return null;
}

const zurichMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()).slice(0, 7);

export default function RosterPlanner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("monat") ?? "") ? params.get("monat")! : zurichMonth();
  const view = params.get("ansicht") === "woche" ? "woche" : "monat";
  const unitParam = params.get("einheit");
  const url = `/api/dienstplan/schedule?monat=${month}${unitParam ? `&einheit=${unitParam}` : ""}`;
  const { data, error, loading, reload, setData } = useRosterData<SchedulePayload>(
    url,
    (loaded) =>
      `/api/dienstplan/changes?einheit=${loaded.unit.id}&monat=${loaded.year}-${String(loaded.month).padStart(2, "0")}`,
  );

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [prompt, setPrompt] = useState<ViolationPrompt | null>(null);
  // Dienst-Palette ("Stempel") wie im PEP: gewählter Diensttyp, "clear" oder aus.
  const [paintTool, setPaintTool] = useState<PaintTool>(null);
  useEffect(() => {
    if (!paintTool) return;
    const onKey = (event: globalThis.KeyboardEvent) => event.key === "Escape" && setPaintTool(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paintTool]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [qualificationFilter, setQualificationFilter] = useState("");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState<Set<string> | null>(null);
  // Verlauf der Zellen-Änderungen dieses Monats und Wohnbereichs (Rückgängig/Wiederholen).
  const [history, setHistory] = useState<History>({ key: "", undo: [], redo: [] });
  const historyKey = data ? `${data.unit.id}|${data.year}-${data.month}` : "";
  const undoStack = history.key === historyKey ? history.undo : [];
  const redoStack = history.key === historyKey ? history.redo : [];

  const navigate = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const [year, monthNumber] = month.split("-").map(Number);
  const goMonth = (delta: number) => {
    const next = shiftMonth(year, monthNumber, delta);
    navigate({ monat: `${next.year}-${String(next.month).padStart(2, "0")}`, woche: null });
  };

  const days = useMemo(() => {
    if (!data) return [];
    if (view === "monat") return data.days;
    const start = params.get("woche") ?? weekStart(data.days.find((d) => d.today)?.date ?? data.days[0].date);
    const inWeek = new Set(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    const week = data.days.filter((day) => inWeek.has(day.date));
    return week.length ? week : data.days.slice(0, 7);
  }, [data, view, params]);

  // Weeks are shown within the month of their Monday (partial weeks at month edges).
  const goWeek = (delta: number) => {
    if (!days[0]) return;
    const start = addDays(weekStart(days[0].date), delta * 7);
    navigate({ woche: start, monat: start.slice(0, 7) });
  };

  const shifts = useMemo(() => {
    if (!data) return [];
    return data.shifts.filter(
      (shift) =>
        (!typeFilter || shift.shiftTypeId === typeFilter) &&
        (!conflictsOnly || shift.violations.some((v) => v.severity !== "INFO")),
    );
  }, [data, typeFilter, conflictsOnly]);

  const employees = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLocaleLowerCase("de-CH");
    return data.employees.filter(
      (employee) =>
        (!q || employee.name.toLocaleLowerCase("de-CH").includes(q)) &&
        (!qualificationFilter || employee.qualifications.includes(qualificationFilter)) &&
        (!employeeFilter || employeeFilter.has(employee.id)) &&
        (!conflictsOnly || shifts.some((s) => s.employeeId === employee.id)),
    );
  }, [data, query, qualificationFilter, employeeFilter, conflictsOnly, shifts]);

  const qualifications = useMemo(
    () => [...new Set((data?.employees ?? []).flatMap((e) => e.qualifications))].sort(),
    [data],
  );

  return (
    <ModulePageShell pageClass="roster-page">
      {(showToast) => {
        // Runs a change; asks for confirmation of warnings, shows blockers, reloads on stale data.
        const run = async (
          operation: (ack: Ack) => Promise<CommitResult | unknown>,
          success: string,
          onDone?: () => void,
        ) => {
          try {
            await operation({});
            onDone?.();
            showToast(success);
            reload();
          } catch (cause) {
            reload();
            if (!(cause instanceof RosterRequestError)) {
              showToast(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
              return;
            }
            if (cause.code === "CONFIRMATION_REQUIRED")
              setPrompt({
                title: "Warnungen bestätigen",
                message: cause.message,
                violations: cause.violations,
                confirm: async (acknowledged, reason) => {
                  await operation({ acknowledgedWarnings: acknowledged, overrideReason: reason });
                  onDone?.();
                  showToast(success);
                  reload();
                },
              });
            else if (cause.violations.length)
              setPrompt({ title: "Änderung nicht möglich", message: cause.message, violations: cause.violations });
            else showToast(cause.message);
          }
        };

        const save = async (
          draft: ShiftDraft,
          times: { plannedStart?: string; plannedEnd?: string },
          shift: GridShift | null,
        ) => {
          const body = {
            employeeId: draft.employeeId,
            date: draft.date,
            shiftTypeId: draft.shiftTypeId,
            notes: draft.notes,
            ...times,
            ...(draft.customTimes ? { breakMinutes: draft.breakMinutes } : {}),
          };
          setDialog(null);
          await run(
            (ack) =>
              shift
                ? rosterRequest(`/api/dienstplan/shifts/${shift.id}`, {
                    method: "PATCH",
                    body: { action: "update", expectedVersion: shift.version, ...body, ...ack },
                  })
                : rosterRequest("/api/dienstplan/shifts", {
                    method: "POST",
                    body: {
                      unitId: data!.unit.id,
                      ...body,
                      addToUnit: data!.candidates.some((person) => person.id === draft.employeeId),
                      ...ack,
                    },
                  }),
            shift ? "Dienst geändert" : "Dienst gespeichert",
          );
        };

        const move = async (shift: GridShift, employeeId: string, date: string, dragged: boolean) => {
          // Optimistic: show the shift at its new place, roll back by reloading on error.
          setData((current) => ({
            ...current,
            shifts: current.shifts.map((s) => (s.id === shift.id ? { ...s, employeeId, date } : s)),
          }));
          await run(
            (ack) =>
              rosterRequest(`/api/dienstplan/shifts/${shift.id}`, {
                method: "PATCH",
                body: { action: "move", expectedVersion: shift.version, employeeId, date, dragged, ...ack },
              }),
            "Dienst verschoben",
          );
        };

        const remove = (shift: GridShift) => {
          setDialog(null);
          void run(
            (ack) =>
              rosterRequest(`/api/dienstplan/shifts/${shift.id}`, {
                method: "PATCH",
                body: { action: "delete", expectedVersion: shift.version, ...ack },
              }),
            "Dienst gelöscht",
          );
        };

        // Mehrere Zellen auf einmal (Kürzel, Stempel, Einfügen, Woche übertragen) – eine Regelprüfung.
        const putCells = (cells: CellValue[], label: string, onDone?: () => void) =>
          run(
            (ack) =>
              rosterRequest("/api/dienstplan/cells", {
                method: "PUT",
                body: { unitId: data!.unit.id, cells, ...ack },
              }),
            label,
            onDone,
          );
        const applyCells = (cells: CellValue[], label: string) => {
          const entry = undoEntry(data!, cells, label);
          return putCells(cells, label, () =>
            setHistory((current) =>
              entry
                ? {
                    key: historyKey,
                    undo: [...(current.key === historyKey ? current.undo : []), entry].slice(-HISTORY_LIMIT),
                    redo: [],
                  }
                : current,
            ),
          );
        };
        // Rückgängig/Wiederholen läuft durch dieselbe Regelprüfung wie jede andere Änderung.
        const step = (direction: "undo" | "redo") => {
          const stack = direction === "undo" ? undoStack : redoStack;
          const entry = stack.at(-1);
          if (!data || !entry || !data.canEdit) return;
          // Die Änderung ist noch nicht neu geladen – kurz warten statt mit veralteten Zellen zu vergleichen.
          if (entry.basis === data) return;
          const pop = (current: History): History =>
            direction === "undo"
              ? { ...current, undo: current.undo.slice(0, -1) }
              : { ...current, redo: current.redo.slice(0, -1) };
          const target = revertCells(data, entry, direction);
          if ("conflict" in target) {
            setHistory({ key: historyKey, undo: [], redo: [] });
            showToast(
              `„${entry.label}“ kann nicht mehr rückgängig gemacht werden – die Zellen wurden inzwischen geändert.`,
            );
            return;
          }
          const name = `${direction === "undo" ? "Rückgängig" : "Wiederholt"}: ${entry.label}`;
          if (!target.cells.length) {
            setHistory(pop);
            showToast(name);
            return;
          }
          void putCells(target.cells, name, () =>
            setHistory((current) => {
              const next = pop(current);
              const moved = { ...entry, basis: data };
              return direction === "undo"
                ? { ...next, redo: [...next.redo, moved] }
                : { ...next, undo: [...next.undo, moved] };
            }),
          );
        };

        const drop = (shift: GridShift, employeeId: string, date: string) => {
          const occupant = data!.shifts.find(
            (s) =>
              s.employeeId === employeeId &&
              s.date === date &&
              s.id !== shift.id &&
              !s.masked &&
              s.category !== "ABSENCE",
          );
          // Never overwrite silently: an occupied cell asks whether to swap.
          if (occupant && employeeId !== shift.employeeId) setDialog({ kind: "swap", source: shift, target: occupant });
          else void move(shift, employeeId, date, true);
        };

        if (error && !data)
          return (
            <main className="workspace roster-workspace">
              <section className="critical-alert" role="alert">
                <span className="critical-symbol">
                  <Warning />
                </span>
                <div>
                  <strong>Dienstplan konnte nicht geladen werden</strong>
                  <p>{error.message}</p>
                </div>
                <button className="secondary-button" type="button" onClick={reload}>
                  Erneut laden
                </button>
              </section>
            </main>
          );

        const period = data?.period;
        const title = monthLabel(year, monthNumber);
        const tiles = data?.tiles;
        const noShifts = data && data.shifts.length === 0;
        const conflicts = data?.shifts.filter((s) => s.violations.some((v) => v.severity !== "INFO")).length ?? 0;

        return (
          <main className="workspace roster-workspace">
            <header className="page-heading roster-heading">
              <div className="heading-copy">
                <p className="eyebrow">Leitung · Dienstplan</p>
                <h1>Dienstplan {data?.unit.name ?? ""}</h1>
                <p>Planen, prüfen und veröffentlichen – jede Änderung läuft durch dieselbe Regelprüfung.</p>
              </div>
              <div className="roster-heading-actions">
                {data?.canEdit && (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() =>
                      setDialog({
                        kind: "create",
                        employeeId: employees[0]?.id ?? data.employees[0]?.id ?? data.candidates[0]?.id ?? "",
                        date: data.days.find((d) => d.today)?.date ?? data.days[0].date,
                      })
                    }
                  >
                    <Plus className="button-icon" /> Dienst hinzufügen
                  </button>
                )}
                {data?.lead && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setDialog({ kind: "ai" })}
                    disabled={!data.canEdit}
                    title={
                      data.aiAvailable
                        ? "Vorschlag der KI – jede Zuweisung wird geprüft"
                        : "KI ist nicht eingerichtet (MISTRAL_API_KEY fehlt)"
                    }
                  >
                    <Sparkle className="button-icon" /> Mit KI planen
                  </button>
                )}
                {data && (
                  <a
                    className="secondary-button"
                    href={`/c/dienstplan/drucken?monat=${month}&einheit=${data.unit.id}`}
                    target="_blank"
                    rel="noopener"
                  >
                    <Printer className="button-icon" /> Drucken / PDF
                  </a>
                )}
                {data?.lead && (
                  <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "analyze" })}>
                    <ChartBar className="button-icon" /> Analysieren
                  </button>
                )}
                {data?.lead && period && (
                  <button
                    className={period.status === "PUBLISHED" ? "secondary-button" : "primary-button"}
                    type="button"
                    onClick={() => setDialog({ kind: "publish" })}
                    disabled={!!period.lockedAt}
                  >
                    <CheckCircle className="button-icon" />{" "}
                    {period.status === "PUBLISHED" ? "Veröffentlicht" : "Veröffentlichen"}
                  </button>
                )}
              </div>
            </header>

            {data && !data.ruleSet.valuesConfirmed && data.lead && (
              <p className="roster-alert">
                Das Regelwerk enthält Beispielwerte (Schweizer ArG) – bitte rechtlich prüfen und unter Einstellungen
                bestätigen.
              </p>
            )}

            <section className="roster-toolbar" aria-label="Monat und Filter">
              <div className="roster-nav">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={view === "woche" ? "Vorherige Woche" : "Vorheriger Monat"}
                  onClick={() => (view === "woche" ? goWeek(-1) : goMonth(-1))}
                >
                  <CaretLeft />
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => navigate({ monat: zurichMonth(), woche: null })}
                >
                  Heute
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={view === "woche" ? "Nächste Woche" : "Nächster Monat"}
                  onClick={() => (view === "woche" ? goWeek(1) : goMonth(1))}
                >
                  <CaretRight />
                </button>
                <label className="roster-month">
                  <span className="sr-only">Monat</span>
                  <input
                    type="month"
                    value={month}
                    onChange={(event) => event.target.value && navigate({ monat: event.target.value, woche: null })}
                  />
                </label>
                <strong className="roster-title">{title}</strong>
                {period && (
                  <span className={`roster-status ${period.status === "PUBLISHED" ? "published" : "draft"}`}>
                    {period.lockedAt ? "Abgeschlossen" : period.status === "PUBLISHED" ? "Veröffentlicht" : "Entwurf"}
                  </span>
                )}
              </div>
              <div className="roster-filters">
                <div className="schedule-view-switch" role="group" aria-label="Ansicht">
                  <button
                    type="button"
                    className={view === "monat" ? "active" : ""}
                    onClick={() => navigate({ ansicht: null, woche: null })}
                  >
                    Monat
                  </button>
                  <button
                    type="button"
                    className={view === "woche" ? "active" : ""}
                    onClick={() => navigate({ ansicht: "woche" })}
                  >
                    Woche
                  </button>
                </div>
                {data && data.units.filter((u) => u.lead).length > 1 && (
                  <CareOptionSelect
                    label="Wohnbereich"
                    value={data.unit.id}
                    onChange={(value) => navigate({ einheit: value })}
                    options={[
                      ...data.units
                        .filter((u) => u.lead)
                        .map((unit) => ({ value: String(unit.id), label: String(unit.name) })),
                    ]}
                  />
                )}
                <label className="roster-search">
                  <MagnifyingGlass aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Person suchen"
                    aria-label="Person suchen"
                  />
                </label>
                <CareOptionSelect
                  label="Diensttyp filtern"
                  value={typeFilter}
                  onChange={(value) => setTypeFilter(value)}
                  options={[
                    { value: "", label: "Alle Diensttypen" },
                    ...(data?.shiftTypes ?? []).map((type) => ({
                      value: String(type.id),
                      label: `${type.code} · ${type.name}`,
                    })),
                  ]}
                />
                <CareOptionSelect
                  label="Qualifikation filtern"
                  value={qualificationFilter}
                  onChange={(value) => setQualificationFilter(value)}
                  options={[
                    { value: "", label: "Alle Qualifikationen" },
                    ...qualifications.map((q) => ({ value: String(q), label: String(q) })),
                  ]}
                />
                <label className="roster-toggle">
                  <input
                    type="checkbox"
                    checked={conflictsOnly}
                    onChange={(event) => setConflictsOnly(event.target.checked)}
                  />
                  Nur Konflikte ({conflicts})
                </label>
              </div>
            </section>

            {tiles && (
              <section className="roster-tiles" aria-label="Übersicht">
                {[
                  {
                    icon: UsersThree,
                    value: tiles.employees,
                    caption: "Mitarbeitende",
                    onClick: () => setEmployeeFilter(null),
                  },
                  {
                    icon: CalendarDots,
                    value: tiles.shiftsToday,
                    caption: "Dienste heute",
                    onClick: () => navigate({ ansicht: "woche", monat: zurichMonth(), woche: null }),
                  },
                  {
                    icon: ClockCountdown,
                    value: tiles.openTimeOff,
                    caption: "Wunschfrei offen",
                    href: "/c/dienstplan/antraege",
                    tone: tiles.openTimeOff ? "attention" : "",
                  },
                  {
                    icon: ArrowsLeftRight,
                    value: tiles.openSwaps,
                    caption: "Tausch offen",
                    href: "/c/dienstplan/antraege",
                    tone: tiles.openSwaps ? "attention" : "",
                  },
                  {
                    icon: ClockCountdown,
                    value: tiles.deviations,
                    caption: "Zeitabweichungen",
                    href: "/c/dienstplan/arbeitszeit",
                    tone: tiles.deviations ? "attention" : "",
                  },
                  {
                    icon: Warning,
                    value: tiles.understaffedDays,
                    caption: "Tage unterbesetzt",
                    onClick: () => setDialog({ kind: "analyze" }),
                    tone: tiles.understaffedDays ? "critical" : "",
                  },
                  {
                    icon: ChartBar,
                    value: tiles.targetDeviations,
                    caption: "Soll-Abweichungen",
                    onClick: () =>
                      setEmployeeFilter(
                        new Set(
                          data!.violations
                            .filter((v) => v.code === "TARGET_DEVIATION" && v.employeeId)
                            .map((v) => v.employeeId!),
                        ),
                      ),
                    tone: tiles.targetDeviations ? "attention" : "",
                  },
                ].map((tile) => (
                  <button
                    key={tile.caption}
                    type="button"
                    className={`roster-tile ${tile.tone ?? ""}`}
                    onClick={() => (tile.href ? router.push(tile.href) : tile.onClick?.())}
                  >
                    <tile.icon aria-hidden="true" />
                    <strong>{tile.value}</strong>
                    <small>{tile.caption}</small>
                  </button>
                ))}
              </section>
            )}
            {employeeFilter && (
              <p className="roster-filter-note">
                Gefiltert auf {employeeFilter.size} Personen mit Soll-Abweichung.{" "}
                <button type="button" className="quiet-button" onClick={() => setEmployeeFilter(null)}>
                  Filter aufheben
                </button>
              </p>
            )}

            <section className="card roster-card" aria-busy={loading}>
              {!data ? (
                <div className="roster-skeleton" aria-label="Dienstplan wird geladen">
                  {Array.from({ length: 8 }, (_, i) => (
                    <span key={i} />
                  ))}
                </div>
              ) : !data.employees.length ? (
                <div className="roster-empty">
                  <strong>Noch keine Mitarbeitenden in {data.unit.name}</strong>
                  <p>
                    {data.canEdit && data.candidates.length
                      ? "Mit „Dienst hinzufügen“ Personen des Hauses einplanen – sie werden dabei dem Wohnbereich zugeordnet. Alternativ unter Einstellungen › Personal."
                      : "Unter Einstellungen › Personal können Personen dem Wohnbereich zugeordnet werden."}
                  </p>
                </div>
              ) : (
                <>
                  {noShifts && (
                    <div className="roster-empty inline">
                      <strong>Noch keine Dienste für {title}</strong>
                      <p>Dienst hinzufügen (Doppelklick auf eine Zelle) oder mit KI planen.</p>
                    </div>
                  )}
                  {data.canEdit && (
                    <div className="roster-palette" role="toolbar" aria-label="Dienst-Palette">
                      <span className="roster-palette-label">Stempel</span>
                      <button
                        type="button"
                        className={paintTool === null ? "active" : ""}
                        aria-pressed={paintTool === null}
                        onClick={() => setPaintTool(null)}
                        title="Markieren: Zelle anklicken, Kürzel tippen"
                      >
                        Markieren
                      </button>
                      {data.shiftTypes
                        .filter((type) => type.active)
                        .map((type) => (
                          <button
                            key={type.id}
                            type="button"
                            className={`roster-palette-code ${paintTool === type.id ? "active" : ""}`}
                            style={{ "--chip-color": type.color } as React.CSSProperties}
                            aria-pressed={paintTool === type.id}
                            title={`${type.name} ${type.startTime}–${type.endTime} – Zellen anklicken oder überstreichen`}
                            onClick={() => setPaintTool(paintTool === type.id ? null : type.id)}
                          >
                            {type.code}
                          </button>
                        ))}
                      <button
                        type="button"
                        className={paintTool === "clear" ? "active" : ""}
                        aria-pressed={paintTool === "clear"}
                        onClick={() => setPaintTool(paintTool === "clear" ? null : "clear")}
                        title="Radierer: Zellen anklicken oder überstreichen"
                      >
                        Leeren
                      </button>
                      <button
                        type="button"
                        className="roster-palette-action"
                        onClick={() => step("undo")}
                        disabled={!undoStack.length}
                        title={
                          undoStack.length ? `Rückgängig: ${undoStack.at(-1)!.label} (Strg+Z)` : "Rückgängig (Strg+Z)"
                        }
                      >
                        <ArrowCounterClockwise aria-hidden="true" /> Rückgängig
                      </button>
                      <button
                        type="button"
                        onClick={() => step("redo")}
                        disabled={!redoStack.length}
                        title={
                          redoStack.length ? `Wiederholen: ${redoStack.at(-1)!.label} (Strg+Y)` : "Wiederholen (Strg+Y)"
                        }
                      >
                        <ArrowClockwise aria-hidden="true" /> Wiederholen
                      </button>
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: "copy-week" })}
                        disabled={!employees.length}
                      >
                        <CopySimple aria-hidden="true" /> Woche übertragen
                      </button>
                    </div>
                  )}
                  <RosterGrid
                    data={data}
                    days={days}
                    employees={employees}
                    shifts={shifts}
                    highlightShiftIds={conflictsOnly ? new Set(shifts.map((s) => s.id)) : null}
                    onCreate={(employeeId, date) => setDialog({ kind: "create", employeeId, date })}
                    onOpen={(shift) => setDialog({ kind: "detail", shift })}
                    onDrop={drop}
                    onApplyCells={(cells, label) => void applyCells(cells, label)}
                    paintTool={paintTool}
                    onNotice={showToast}
                  />
                  <p className="roster-legend">
                    {data.canEdit
                      ? "Zelle anklicken und Kürzel tippen (Enter übernimmt), Entf leert, Shift+Pfeile oder Ziehen markiert einen Bereich, Strg+C/V kopiert und fügt ein (auch aus Excel), Strg+Z macht rückgängig. Doppelklick öffnet, Dienst ziehen verschiebt."
                      : "Tastatur: Pfeiltasten, Enter öffnet."}
                    {data.shiftTypes.map((type) => (
                      <span key={type.id}>
                        <i style={{ background: type.color }} /> {type.code} {type.name}
                      </span>
                    ))}
                  </p>
                </>
              )}
            </section>

            {data && dialog?.kind === "create" && (
              <ShiftEditor
                data={data}
                shift={null}
                initial={{ employeeId: dialog.employeeId, date: dialog.date }}
                onClose={() => setDialog(null)}
                onSave={(draft, times) => save(draft, times, null)}
              />
            )}
            {data && dialog?.kind === "edit" && (
              <ShiftEditor
                data={data}
                shift={dialog.shift}
                initial={{ employeeId: dialog.shift.employeeId, date: dialog.shift.date }}
                onClose={() => setDialog(null)}
                onSave={(draft, times) => save(draft, times, dialog.shift)}
                onDelete={() => remove(dialog.shift)}
              />
            )}
            {data && dialog?.kind === "detail" && (
              <ShiftDetail
                data={data}
                shift={dialog.shift}
                onClose={() => setDialog(null)}
                onEdit={() => setDialog({ kind: "edit", shift: dialog.shift })}
                onMove={() => setDialog({ kind: "move", shift: dialog.shift })}
                onDelete={() => remove(dialog.shift)}
              />
            )}
            {data && dialog?.kind === "move" && (
              <MoveDialog
                data={data}
                shift={dialog.shift}
                onClose={() => setDialog(null)}
                onMove={async (employeeId, date) => {
                  setDialog(null);
                  await move(dialog.shift, employeeId, date, false);
                }}
              />
            )}
            {data && dialog?.kind === "swap" && (
              <SidePanel
                id="roster-swap"
                eyebrow="Dienstplan"
                title="Dienste tauschen?"
                description="Die Zelle ist bereits belegt. Beide Dienste werden geprüft und nur gemeinsam getauscht."
                onClose={() => setDialog(null)}
                actions={
                  <>
                    <button className="secondary-button" type="button" onClick={() => setDialog(null)}>
                      Abbrechen
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => {
                        const { source, target } = dialog;
                        setDialog(null);
                        void run(
                          (ack) =>
                            rosterRequest(`/api/dienstplan/shifts/${source.id}`, {
                              method: "PATCH",
                              body: {
                                action: "swap",
                                expectedVersion: source.version,
                                targetShiftId: target.id,
                                targetVersion: target.version,
                                ...ack,
                              },
                            }),
                          "Dienste getauscht",
                        );
                      }}
                    >
                      Dienste tauschen
                    </button>
                  </>
                }
              >
                <p>
                  <strong>{data.employees.find((e) => e.id === dialog.source.employeeId)?.name}</strong>:{" "}
                  {dialog.source.name} am {dialog.source.date.slice(8)}.{dialog.source.date.slice(5, 7)}.
                </p>
                <p>
                  <strong>{data.employees.find((e) => e.id === dialog.target.employeeId)?.name}</strong>:{" "}
                  {dialog.target.name} am {dialog.target.date.slice(8)}.{dialog.target.date.slice(5, 7)}.
                </p>
              </SidePanel>
            )}
            {data && (dialog?.kind === "publish" || dialog?.kind === "analyze") && (
              <PublishPanel
                data={data}
                mode={dialog.kind}
                onClose={() => setDialog(null)}
                onDone={(message) => {
                  setDialog(null);
                  showToast(message);
                  reload();
                }}
              />
            )}
            {data && dialog?.kind === "ai" && (
              <AiPlanningPanel
                data={data}
                onClose={() => setDialog(null)}
                onApplied={(message) => {
                  setDialog(null);
                  showToast(message);
                  reload();
                }}
              />
            )}
            {data && dialog?.kind === "copy-week" && (
              <CopyWeekDialog
                data={data}
                employees={employees}
                initialWeek={view === "woche" && days[0] ? weekStart(days[0].date) : null}
                onClose={() => setDialog(null)}
                onApply={async (cells, label) => {
                  setDialog(null);
                  await applyCells(cells, label);
                }}
              />
            )}
            {prompt && <ViolationDialog prompt={prompt} onClose={() => setPrompt(null)} />}
            <UndoKeys
              enabled={!!data?.canEdit && !dialog && !prompt}
              onUndo={() => step("undo")}
              onRedo={() => step("redo")}
            />
          </main>
        );
      }}
    </ModulePageShell>
  );
}
