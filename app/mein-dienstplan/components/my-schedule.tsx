"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, CaretLeft, CaretRight, Coffee, SignIn, SignOut, Warning } from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import { rosterRequest, useRosterData } from "@/app/dienstplan/components/roster-api";
import { SidePanel } from "@/app/dienstplan/components/side-panel";
import type { MySchedulePayload, MyShift } from "@/lib/roster/my-schedule";
import {
  addDays,
  formatDate,
  formatHours,
  formatSignedMinutes,
  isoWeek,
  localTime,
  monthLabel,
  shiftMonth,
  weekStart,
  weekday,
} from "@/lib/roster/time";
import { SWAP_STATUS_LABELS, TIME_ENTRY_STATUS_LABELS, WEEKDAY_SHORT } from "@/lib/roster/types";
import { AbsenceDialog, CorrectionDialog, SwapDialog, TimeOffDialog } from "./request-forms";

type Dialog =
  | { kind: "detail"; shift: MyShift }
  | { kind: "swap"; shift: MyShift }
  | { kind: "correction"; entry: NonNullable<MyShift["entry"]>; label: string }
  | { kind: "time-off" | "absence" };

const zurichMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()).slice(0, 7);

// Mein Dienstplan (Spec 8.5): eigene Dienste, Summen, Stempeln, Tausch und Korrektur.
export default function MySchedule() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("monat") ?? "") ? params.get("monat")! : zurichMonth();
  const view = params.get("ansicht") === "monat" ? "monat" : "woche";
  const { data, error, loading, reload } = useRosterData<MySchedulePayload>(
    `/api/dienstplan/me?monat=${month}`,
    () => `/api/dienstplan/me/changes?monat=${month}`,
  );
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [week, setWeek] = useState<string | null>(null);

  const navigate = (next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    router.replace(`${pathname}?${query}`, { scroll: false });
  };
  const [year, monthNumber] = month.split("-").map(Number);
  const currentWeek = week ?? (data ? weekStart(data.today.slice(0, 7) === month ? data.today : `${month}-01`) : null);
  const byDate = useMemo(() => {
    const map = new Map<string, MyShift[]>();
    for (const shift of data?.shifts ?? []) map.set(shift.date, [...(map.get(shift.date) ?? []), shift]);
    return map;
  }, [data]);
  const visibleDays = useMemo(() => {
    if (!data) return [];
    if (view === "monat") return data.days;
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeek!, i));
  }, [data, view, currentWeek]);

  return (
    <ModulePageShell pageClass="roster-page">
      {(showToast) => {
        const finish = (message: string) => {
          setDialog(null);
          showToast(message);
          reload();
        };
        const clock = async (action: "in" | "out" | "break-start" | "break-end") => {
          setBusy(true);
          try {
            const result = await rosterRequest<{
              unplanned?: boolean;
              differenceMinutes?: number | null;
              breakShortfall?: number;
            }>("/api/dienstplan/time/clock", {
              method: "POST",
              body: { action, shiftId: action === "in" ? data?.clock?.shiftId : undefined },
            });
            const messages = {
              in: result.unplanned ? "Ungeplanter Einsatz eingestempelt – die Leitung ist informiert" : "Eingestempelt",
              out:
                result.differenceMinutes !== null && result.differenceMinutes !== undefined
                  ? `Ausgestempelt · Differenz ${formatSignedMinutes(result.differenceMinutes)}${result.breakShortfall ? ` · Pause ${result.breakShortfall} Min zu kurz` : ""}`
                  : "Ausgestempelt",
              "break-start": "Pause gestartet",
              "break-end": "Pause beendet",
            };
            showToast(messages[action]);
          } catch (cause) {
            showToast(cause instanceof Error ? cause.message : "Die Zeiterfassung ist fehlgeschlagen.");
          } finally {
            setBusy(false);
            reload();
          }
        };

        if (error && !data)
          return (
            <main className="workspace roster-workspace">
              <section className="critical-alert" role="alert">
                <span className="critical-symbol">
                  <Warning />
                </span>
                <div>
                  <strong>Dein Dienstplan konnte nicht geladen werden</strong>
                  <p>{error.message}</p>
                </div>
                <button className="secondary-button" type="button" onClick={reload}>
                  Erneut laden
                </button>
              </section>
            </main>
          );

        const summary = data?.summary;
        const open = data?.openEntry;
        const tz = data?.timezone ?? "Europe/Zurich";
        const time = (shift: MyShift) => `${localTime(shift.plannedStart, tz)}–${localTime(shift.plannedEnd, tz)}`;
        return (
          <main className="workspace roster-workspace">
            <header className="page-heading roster-heading">
              <div className="heading-copy">
                <p className="eyebrow">Mein Dienst · Dienstplan</p>
                <h1>Meine Dienste</h1>
                <p>Veröffentlichte Dienste aller deiner Wohnbereiche, deine Stunden und die Zeiterfassung.</p>
              </div>
              <div className="roster-heading-actions">
                <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "absence" })}>
                  Abwesenheit melden
                </button>
                <button className="primary-button" type="button" onClick={() => setDialog({ kind: "time-off" })}>
                  <CalendarPlus className="button-icon" /> Wunschfrei
                </button>
              </div>
            </header>

            {data?.clock && (
              <section className="my-roster-clock" aria-live="polite">
                <div>
                  <strong>{data.clock.label}</strong>
                  <p>{data.clock.hint}</p>
                </div>
                <div className="roster-row-actions">
                  {open ? (
                    <>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        onClick={() => clock(open.breakStartedAt ? "break-end" : "break-start")}
                      >
                        <Coffee className="button-icon" /> {open.breakStartedAt ? "Pause beenden" : "Pause starten"}
                      </button>
                      <button
                        className="primary-button my-roster-clock-button"
                        type="button"
                        disabled={busy}
                        onClick={() => clock("out")}
                      >
                        <SignOut className="button-icon" /> Ausstempeln
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary-button my-roster-clock-button"
                      type="button"
                      disabled={busy || !data.clock.canClockIn}
                      onClick={() => clock("in")}
                    >
                      <SignIn className="button-icon" /> Einstempeln
                    </button>
                  )}
                </div>
              </section>
            )}

            <section className="my-roster-totals" aria-label={`Stunden ${monthLabel(year, monthNumber)}`}>
              <div>
                <small>Soll</small>
                <strong>{summary ? formatHours(summary.targetMinutes) : "–"}</strong>
              </div>
              <div>
                <small>Geplant</small>
                <strong>{summary ? formatHours(summary.plannedMinutes) : "–"}</strong>
              </div>
              <div>
                <small>Ist (erfasst)</small>
                <strong>{summary ? formatHours(summary.actualMinutes) : "–"}</strong>
              </div>
              <div>
                <small>{month === zurichMonth() ? "Saldo bis heute" : "Saldo"}</small>
                <strong>{summary ? formatHours(summary.balanceMinutes, true) : "–"}</strong>
              </div>
            </section>

            <section className="roster-toolbar">
              <div className="roster-nav">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Vorheriger Monat"
                  onClick={() => {
                    const prev = shiftMonth(year, monthNumber, -1);
                    setWeek(null);
                    navigate({ monat: `${prev.year}-${String(prev.month).padStart(2, "0")}` });
                  }}
                >
                  <CaretLeft />
                </button>
                <strong className="roster-title">{monthLabel(year, monthNumber)}</strong>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Nächster Monat"
                  onClick={() => {
                    const next = shiftMonth(year, monthNumber, 1);
                    setWeek(null);
                    navigate({ monat: `${next.year}-${String(next.month).padStart(2, "0")}` });
                  }}
                >
                  <CaretRight />
                </button>
                {view === "woche" && currentWeek && (
                  <span className="roster-nav">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Vorherige Woche"
                      disabled={currentWeek <= `${month}-01`}
                      onClick={() => setWeek(addDays(currentWeek, -7))}
                    >
                      <CaretLeft />
                    </button>
                    <span className="roster-muted">KW {isoWeek(currentWeek).week}</span>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Nächste Woche"
                      disabled={addDays(currentWeek, 7) > (data?.days.at(-1) ?? "")}
                      onClick={() => setWeek(addDays(currentWeek, 7))}
                    >
                      <CaretRight />
                    </button>
                  </span>
                )}
              </div>
              <div className="roster-filters">
                <div className="schedule-view-switch" role="group" aria-label="Ansicht">
                  <button
                    type="button"
                    className={view === "woche" ? "active" : ""}
                    onClick={() => navigate({ ansicht: null })}
                  >
                    Woche
                  </button>
                  <button
                    type="button"
                    className={view === "monat" ? "active" : ""}
                    onClick={() => navigate({ ansicht: "monat" })}
                  >
                    Monat
                  </button>
                </div>
              </div>
            </section>

            <section className="card roster-card">
              {loading && !data ? (
                <div className="roster-skeleton">
                  {Array.from({ length: 7 }, (_, i) => (
                    <span key={i} />
                  ))}
                </div>
              ) : (
                <div className="my-roster-week">
                  {visibleDays.map((day) => {
                    const shifts = byDate.get(day) ?? [];
                    const inMonth = day.slice(0, 7) === month;
                    const label = `${WEEKDAY_SHORT[weekday(day) - 1]} ${formatDate(day)}`;
                    if (!shifts.length)
                      return (
                        <div key={day} className={`my-roster-day free${day === data?.today ? " today" : ""}`}>
                          <span>{label}</span>
                          <span>{inMonth ? "frei" : "anderer Monat"}</span>
                          <span />
                        </div>
                      );
                    return shifts.map((shift) => (
                      <button
                        key={shift.id}
                        type="button"
                        className={`my-roster-day${day === data?.today ? " today" : ""}`}
                        onClick={() => setDialog({ kind: "detail", shift })}
                      >
                        <span>{label}</span>
                        <span>
                          <strong>
                            <span className="roster-type-dot" style={{ background: shift.color }} /> {shift.code} ·{" "}
                            {shift.name}
                          </strong>
                          {shift.category === "ABSENCE" ? "ganztags" : time(shift)}
                          {data && data.units.length > 1 ? ` · ${shift.unitName}` : ""}
                        </span>
                        <span className="roster-row-actions">
                          {shift.entry && (
                            <span className={`roster-pill${shift.entry.status === "INCOMPLETE" ? " critical" : " ok"}`}>
                              {TIME_ENTRY_STATUS_LABELS[shift.entry.status]}
                              {shift.entry.actualMinutes !== null ? ` · ${formatHours(shift.entry.actualMinutes)}` : ""}
                            </span>
                          )}
                          {shift.swap && shift.swap.status !== "EXECUTED" && (
                            <span className="roster-pill attention">{SWAP_STATUS_LABELS[shift.swap.status]}</span>
                          )}
                          {shift.swapped && <span className="roster-pill">getauscht</span>}
                        </span>
                      </button>
                    ));
                  })}
                  {data && !data.shifts.length && (
                    <p className="roster-muted">
                      Für {monthLabel(year, monthNumber)} ist noch kein Plan veröffentlicht.
                    </p>
                  )}
                </div>
              )}
            </section>

            {data && data.unplannedEntries.length > 0 && (
              <section className="card roster-card">
                <div className="roster-section-head">
                  <div>
                    <h2>Ungeplante Einsätze</h2>
                    <p>Einsätze ohne geplanten Dienst; die Leitung wurde jeweils informiert.</p>
                  </div>
                </div>
                <div className="roster-table-wrap">
                  <table className="roster-table">
                    <thead>
                      <tr>
                        <th>Datum</th>
                        <th>Zeit</th>
                        <th>Ist</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.unplannedEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatDate(entry.date, true)}</td>
                          <td>
                            {localTime(entry.clockIn, tz)}–{entry.clockOut ? localTime(entry.clockOut, tz) : "läuft"}
                          </td>
                          <td>{entry.actualMinutes !== null ? formatHours(entry.actualMinutes) : "–"}</td>
                          <td>{TIME_ENTRY_STATUS_LABELS[entry.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {dialog?.kind === "detail" && data && (
              <MyShiftDetail
                shift={dialog.shift}
                timezone={tz}
                onClose={() => setDialog(null)}
                onSwap={() => setDialog({ kind: "swap", shift: dialog.shift })}
                onCorrection={() =>
                  dialog.shift.entry &&
                  setDialog({
                    kind: "correction",
                    entry: dialog.shift.entry,
                    label: `${dialog.shift.name} · ${formatDate(dialog.shift.date, true)}`,
                  })
                }
              />
            )}
            {dialog?.kind === "swap" && (
              <SwapDialog shiftId={dialog.shift.id} onClose={() => setDialog(null)} onDone={finish} />
            )}
            {dialog?.kind === "correction" && (
              <CorrectionDialog
                entry={dialog.entry}
                timezone={tz}
                title={`Korrektur · ${dialog.label}`}
                onClose={() => setDialog(null)}
                onDone={finish}
              />
            )}
            {dialog?.kind === "time-off" && data && (
              <TimeOffDialog today={data.today} onClose={() => setDialog(null)} onDone={finish} />
            )}
            {dialog?.kind === "absence" && data && (
              <AbsenceDialog today={data.today} onClose={() => setDialog(null)} onDone={finish} />
            )}
          </main>
        );
      }}
    </ModulePageShell>
  );
}

function MyShiftDetail({
  shift,
  timezone,
  onClose,
  onSwap,
  onCorrection,
}: {
  shift: MyShift;
  timezone: string;
  onClose: () => void;
  onSwap: () => void;
  onCorrection: () => void;
}) {
  const tradable = shift.tradable;
  const correctable = shift.entry && shift.entry.status !== "OPEN" && shift.entry.status !== "APPROVED";
  return (
    <SidePanel
      id="my-shift-detail"
      eyebrow={`Mein Dienstplan · ${shift.unitName}`}
      title={`${shift.name} · ${formatDate(shift.date, true)}`}
      onClose={onClose}
      actions={
        <>
          {correctable && (
            <button className="secondary-button" type="button" onClick={onCorrection}>
              Korrektur beantragen
            </button>
          )}
          {tradable && (
            <button className="primary-button" type="button" onClick={onSwap}>
              Tausch anfragen
            </button>
          )}
          {!tradable && !correctable && (
            <button className="secondary-button" type="button" onClick={onClose}>
              Schliessen
            </button>
          )}
        </>
      }
    >
      <dl className="roster-facts">
        <div>
          <dt>Diensttyp</dt>
          <dd>
            <span className="roster-type-dot" style={{ background: shift.color }} /> {shift.code} · {shift.name}
          </dd>
        </div>
        <div>
          <dt>Wohnbereich</dt>
          <dd>{shift.unitName}</dd>
        </div>
        {shift.category !== "ABSENCE" && (
          <div>
            <dt>Geplant</dt>
            <dd>
              {localTime(shift.plannedStart, timezone)}–{localTime(shift.plannedEnd, timezone)} · Pause{" "}
              {shift.breakMinutes} Min
            </dd>
          </div>
        )}
        {shift.entry && (
          <div>
            <dt>Ist ({TIME_ENTRY_STATUS_LABELS[shift.entry.status]})</dt>
            <dd>
              {localTime(shift.entry.clockIn, timezone)}–
              {shift.entry.clockOut ? localTime(shift.entry.clockOut, timezone) : "läuft"} · Pause{" "}
              {shift.entry.breakMinutes} Min
              {shift.entry.differenceMinutes !== null &&
                ` · Differenz ${formatSignedMinutes(shift.entry.differenceMinutes)}`}
            </dd>
          </div>
        )}
        {shift.swap && (
          <div>
            <dt>Tausch</dt>
            <dd>
              {SWAP_STATUS_LABELS[shift.swap.status]} · mit {shift.swap.with}
            </dd>
          </div>
        )}
      </dl>
      {!tradable && shift.category !== "ABSENCE" && !shift.entry && shift.swap?.status?.startsWith("PENDING") && (
        <p className="roster-muted">Für diesen Dienst läuft bereits eine Tauschanfrage.</p>
      )}
    </SidePanel>
  );
}
