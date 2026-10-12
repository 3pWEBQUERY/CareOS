"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight, DownloadSimple, LockSimple, LockSimpleOpen, Warning } from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import { CorrectionDialog, DecisionDialog } from "@/app/mein-dienstplan/components/request-forms";
import type { TimesheetEntry, TimesheetRow } from "@/lib/roster/time-service";
import { formatDate, formatHours, formatSignedMinutes, localTime, monthLabel, shiftMonth } from "@/lib/roster/time";
import { ABSENCE_LABELS, TIME_ENTRY_STATUS_LABELS, type AbsenceKind } from "@/lib/roster/types";
import { rosterRequest, useRosterData } from "./roster-api";
import { CareOptionSelect } from "@/app/components/care-form-controls";

type Payload = {
  year: number;
  month: number;
  unitId: string | null;
  timezone: string;
  rows: TimesheetRow[];
  entries: TimesheetEntry[];
  shiftTypes: Array<{ id: string; code: string; name: string }>;
  people: Array<{ id: string; name: string }>;
  period: { id: string; status: string; lockedAt: string | null; version: number } | null;
  deviationThreshold: number;
};
type Units = { units: Array<{ id: string; name: string; lead: boolean }> };
type Dialog =
  | { kind: "correct"; entry: TimesheetEntry }
  | { kind: "decide"; entry: TimesheetEntry; decision: "APPROVED" | "REJECTED" }
  | { kind: "unlock" };

const zurichMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()).slice(0, 7);

// Soll/Ist-Auswertung (Spec 8.10/8.11). "own": eigene Zeiten; sonst Leitung mit Filtern,
// Korrektur und Monatsabschluss.
// Lohn-Export: Fehler (z. B. noch keine Lohnarten) als Hinweis statt als heruntergeladene Fehlerdatei.
async function downloadPayroll(url: string, showToast: (message: string) => void) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      showToast(payload?.error?.message ?? "Der Export konnte nicht erstellt werden.");
      return;
    }
    const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "lohn.csv";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await response.blob());
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch {
    showToast("Keine Verbindung. Bitte Netzwerk prüfen und erneut versuchen.");
  }
}

export default function TimesheetWorkspace({ own }: { own?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("monat") ?? "") ? params.get("monat")! : zurichMonth();
  const filters = own
    ? { eigene: "1" }
    : Object.fromEntries(
        ["einheit", "person", "diensttyp"].flatMap((key) => (params.get(key) ? [[key, params.get(key)!]] : [])),
      );
  const query = new URLSearchParams({ monat: month, ...filters });
  const { data, error, loading, reload } = useRosterData<Payload>(`/api/dienstplan/time?${query}`);
  const units = useRosterData<Units>(own ? null : "/api/dienstplan/settings");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const [year, monthNumber] = month.split("-").map(Number);
  const goMonth = (delta: number) => {
    const next = shiftMonth(year, monthNumber, delta);
    navigate({ monat: `${next.year}-${String(next.month).padStart(2, "0")}` });
  };
  const tz = data?.timezone ?? "Europe/Zurich";
  const locked = !!data?.period?.lockedAt;
  const threshold = data?.deviationThreshold ?? 15;
  const deviates = (entry: TimesheetEntry) =>
    Math.abs(entry.startDeviationMinutes ?? 0) > threshold || Math.abs(entry.endDeviationMinutes ?? 0) > threshold;
  const own_row = own ? data?.rows[0] : undefined;
  const exportUrl = (art: "summen" | "eintraege" | "lohn") => {
    const next = new URLSearchParams(query);
    if (data?.unitId) next.set("einheit", data.unitId);
    next.set("art", art);
    return `/api/dienstplan/time/export?${next}`;
  };

  return (
    <ModulePageShell pageClass="roster-page">
      {(showToast) => {
        const done = (message: string) => {
          setDialog(null);
          showToast(message);
          reload();
        };
        const lock = async () => {
          if (!data?.period) return;
          setBusy(true);
          try {
            await rosterRequest(`/api/dienstplan/periods/${data.period.id}`, {
              method: "POST",
              body: { action: "lock", expectedVersion: data.period.version },
            });
            showToast(`${monthLabel(year, monthNumber)} abgeschlossen`);
          } catch (cause) {
            showToast(cause instanceof Error ? cause.message : "Abschluss fehlgeschlagen.");
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
                  <strong>Arbeitszeiten konnten nicht geladen werden</strong>
                  <p>{error.message}</p>
                </div>
                <button className="secondary-button" type="button" onClick={reload}>
                  Erneut laden
                </button>
              </section>
            </main>
          );
        return (
          <main className="workspace roster-workspace">
            <header className="page-heading roster-heading">
              <div className="heading-copy">
                <p className="eyebrow">{own ? "Mein Dienst · Dienstplan" : "Leitung · Dienstplan"}</p>
                <h1>{own ? "Meine Zeiten" : "Arbeitszeit"}</h1>
                <p>
                  {own
                    ? "Erfasste Arbeitszeiten, Soll und Saldo. Fehler meldest du über „Korrektur beantragen“."
                    : "Soll, Plan und Ist je Person, Abweichungen und Korrekturen. Abgeschlossene Monate sind gesperrt."}
                </p>
              </div>
              {!own && data && (
                <div className="roster-heading-actions">
                  <a className="secondary-button" href={exportUrl("summen")} download>
                    <DownloadSimple className="button-icon" /> CSV Summen
                  </a>
                  <a className="secondary-button" href={exportUrl("eintraege")} download>
                    <DownloadSimple className="button-icon" /> CSV Einträge
                  </a>
                  <button
                    className="secondary-button"
                    type="button"
                    title="Lohnarten gemäss Einstellungen, Personen mit diesem Stammwohnbereich"
                    onClick={() => void downloadPayroll(exportUrl("lohn"), showToast)}
                  >
                    <DownloadSimple className="button-icon" /> CSV Lohn
                  </button>
                  {!data.period ? null : locked ? (
                    <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "unlock" })}>
                      <LockSimpleOpen className="button-icon" /> Monat wieder öffnen
                    </button>
                  ) : (
                    <button className="primary-button" type="button" disabled={busy} onClick={lock}>
                      <LockSimple className="button-icon" /> Monat abschliessen
                    </button>
                  )}
                </div>
              )}
            </header>

            <section className="roster-toolbar" aria-label="Monat und Filter">
              <div className="roster-nav">
                <button type="button" className="icon-button" aria-label="Vorheriger Monat" onClick={() => goMonth(-1)}>
                  <CaretLeft />
                </button>
                <button type="button" className="icon-button" aria-label="Nächster Monat" onClick={() => goMonth(1)}>
                  <CaretRight />
                </button>
                <label className="roster-month">
                  <span className="sr-only">Monat</span>
                  <input
                    type="month"
                    value={month}
                    onChange={(event) => event.target.value && navigate({ monat: event.target.value })}
                  />
                </label>
                <strong className="roster-title">{monthLabel(year, monthNumber)}</strong>
                {locked && <span className="roster-status published">Abgeschlossen</span>}
              </div>
              {!own && data && (
                <div className="roster-filters">
                  {(units.data?.units.filter((u) => u.lead).length ?? 0) > 1 && (
                    <CareOptionSelect
                      label="Wohnbereich"
                      value={data.unitId ?? ""}
                      onChange={(value) => navigate({ einheit: value, person: null })}
                      options={[
                        ...units
                          .data!.units.filter((u) => u.lead)
                          .map((unit) => ({ value: String(unit.id), label: String(unit.name) })),
                      ]}
                    />
                  )}
                  <CareOptionSelect
                    label="Person"
                    value={params.get("person") ?? ""}
                    onChange={(value) => navigate({ person: value })}
                    options={[
                      { value: "", label: "Alle Personen" },
                      ...data.people.map((p) => ({ value: String(p.id), label: String(p.name) })),
                    ]}
                  />
                  <CareOptionSelect
                    label="Diensttyp"
                    value={params.get("diensttyp") ?? ""}
                    onChange={(value) => navigate({ diensttyp: value })}
                    options={[
                      { value: "", label: "Alle Diensttypen" },
                      ...data.shiftTypes.map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` })),
                    ]}
                  />
                </div>
              )}
            </section>

            {own && (
              <section className="my-roster-totals" aria-label="Summen">
                <div>
                  <small>Soll</small>
                  <strong>{own_row ? formatHours(own_row.targetMinutes) : "–"}</strong>
                </div>
                <div>
                  <small>Geplant</small>
                  <strong>{own_row ? formatHours(own_row.plannedMinutes) : "–"}</strong>
                </div>
                <div>
                  <small>Ist</small>
                  <strong>{own_row ? formatHours(own_row.actualMinutes) : "–"}</strong>
                </div>
                <div>
                  <small>{month === zurichMonth() ? "Saldo bis heute" : "Saldo"}</small>
                  <strong>{own_row ? formatHours(own_row.balanceMinutes, true) : "–"}</strong>
                </div>
              </section>
            )}

            {!own && (
              <section className="card roster-card">
                <div className="roster-section-head">
                  <div>
                    <h2>Soll/Ist je Person</h2>
                    <p>Soll nach Pensum; Ist aus erfassten Zeiten, Abwesenheiten zählen mit ihrem Sollwert.</p>
                  </div>
                </div>
                <div className="roster-table-wrap">
                  <table className="roster-table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Soll</th>
                        <th>Geplant</th>
                        <th>Ist</th>
                        <th>{month === zurichMonth() ? "Saldo bis heute" : "Saldo"}</th>
                        <th>Nacht</th>
                        <th>Wochenende</th>
                        <th>Feiertag</th>
                        <th>Abwesenheiten</th>
                        <th>Offen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.rows ?? []).map((row) => (
                        <tr key={row.employeeId}>
                          <td>
                            {row.name} <small className="roster-muted">{row.pensumPercent} %</small>
                          </td>
                          <td>{formatHours(row.targetMinutes)}</td>
                          <td>{formatHours(row.plannedMinutes)}</td>
                          <td>{formatHours(row.actualMinutes)}</td>
                          <td>
                            <span
                              className={`roster-pill ${Math.abs(row.balanceMinutes) > 600 ? "attention" : row.balanceMinutes === 0 ? "" : "ok"}`}
                            >
                              {formatHours(row.balanceMinutes, true)}
                            </span>
                          </td>
                          <td>{formatHours(row.nightMinutes)}</td>
                          <td>{formatHours(row.weekendMinutes)}</td>
                          <td>{formatHours(row.holidayMinutes)}</td>
                          <td>
                            {Object.entries(row.absenceDays)
                              .filter(([, days]) => days > 0)
                              .map(([kind, days]) => `${ABSENCE_LABELS[kind as AbsenceKind] ?? kind} ${days} T`)
                              .join(", ") || "–"}
                          </td>
                          <td>
                            {row.notRecorded + row.incomplete > 0 ? (
                              <span className="roster-pill critical">
                                {row.notRecorded ? `${row.notRecorded} nicht erfasst` : ""}
                                {row.notRecorded && row.incomplete ? " · " : ""}
                                {row.incomplete ? `${row.incomplete} unvollständig` : ""}
                              </span>
                            ) : (
                              "–"
                            )}
                          </td>
                        </tr>
                      ))}
                      {data && !data.rows.length && (
                        <tr>
                          <td colSpan={10} className="roster-muted">
                            Keine Personen für diese Filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="card roster-card" aria-busy={loading}>
              <div className="roster-section-head">
                <div>
                  <h2>Zeiteinträge</h2>
                  <p>Abweichungen über {threshold} Minuten zum Plan sind markiert.</p>
                </div>
              </div>
              {loading && !data ? (
                <div className="roster-skeleton">
                  {Array.from({ length: 6 }, (_, i) => (
                    <span key={i} />
                  ))}
                </div>
              ) : (
                <div className="roster-table-wrap">
                  <table className="roster-table">
                    <thead>
                      <tr>
                        <th>Datum</th>
                        {!own && <th>Person</th>}
                        <th>Dienst</th>
                        <th>Geplant</th>
                        <th>Ist</th>
                        <th>Pause</th>
                        <th>Netto</th>
                        <th>Differenz</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.entries ?? []).map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatDate(entry.date, true)}</td>
                          {!own && <td>{entry.employee}</td>}
                          <td>{entry.shift ?? "ungeplant"}</td>
                          <td>{entry.planned ?? "–"}</td>
                          <td>
                            {localTime(entry.clockIn, tz)}–{entry.clockOut ? localTime(entry.clockOut, tz) : "läuft"}
                          </td>
                          <td>
                            {entry.breakMinutes} Min
                            {entry.breakShortfall > 0 && (
                              <span className="roster-pill attention"> {entry.breakShortfall} Min zu kurz</span>
                            )}
                          </td>
                          <td>{entry.actualMinutes !== null ? formatHours(entry.actualMinutes) : "–"}</td>
                          <td>
                            {entry.differenceMinutes !== null ? (
                              <span className={`roster-pill ${deviates(entry) ? "attention" : ""}`}>
                                {formatSignedMinutes(entry.differenceMinutes)}
                              </span>
                            ) : (
                              "–"
                            )}
                          </td>
                          <td>
                            <span
                              className={`roster-pill ${entry.status === "INCOMPLETE" ? "critical" : entry.status === "OPEN" ? "attention" : "ok"}`}
                            >
                              {TIME_ENTRY_STATUS_LABELS[entry.status]}
                            </span>
                            {entry.correction && <span className="roster-pill attention"> Korrektur offen</span>}
                          </td>
                          <td>
                            {!locked && entry.status !== "OPEN" && (
                              <div className="roster-row-actions">
                                {own && !entry.correction && (
                                  <button
                                    className="secondary-button"
                                    type="button"
                                    onClick={() => setDialog({ kind: "correct", entry })}
                                  >
                                    Korrektur beantragen
                                  </button>
                                )}
                                {!own && entry.correction && (
                                  <>
                                    <button
                                      className="secondary-button"
                                      type="button"
                                      onClick={() => setDialog({ kind: "decide", entry, decision: "REJECTED" })}
                                    >
                                      Ablehnen
                                    </button>
                                    <button
                                      className="primary-button"
                                      type="button"
                                      onClick={() => setDialog({ kind: "decide", entry, decision: "APPROVED" })}
                                    >
                                      Korrektur übernehmen
                                    </button>
                                  </>
                                )}
                                {!own && !entry.correction && (
                                  <button
                                    className="secondary-button"
                                    type="button"
                                    onClick={() => setDialog({ kind: "correct", entry })}
                                  >
                                    Korrigieren
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {data && !data.entries.length && (
                        <tr>
                          <td colSpan={own ? 9 : 10} className="roster-muted">
                            Für {monthLabel(year, monthNumber)} sind keine Zeiten erfasst.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {dialog?.kind === "correct" && (
              <CorrectionDialog
                entry={dialog.entry}
                timezone={tz}
                direct={!own}
                title={`${own ? "Korrektur" : "Zeit korrigieren"} · ${formatDate(dialog.entry.date, true)}${own ? "" : ` · ${dialog.entry.employee}`}`}
                onClose={() => setDialog(null)}
                onDone={done}
              />
            )}
            {dialog?.kind === "decide" && dialog.entry.correction && (
              <DecisionDialog
                title={dialog.decision === "APPROVED" ? "Korrektur übernehmen" : "Korrektur ablehnen"}
                description={`${dialog.entry.employee}, ${formatDate(dialog.entry.date, true)}: ${[
                  dialog.entry.correction.clockIn && `Beginn ${localTime(dialog.entry.correction.clockIn, tz)}`,
                  dialog.entry.correction.clockOut && `Ende ${localTime(dialog.entry.correction.clockOut, tz)}`,
                  dialog.entry.correction.breakMinutes !== null && `Pause ${dialog.entry.correction.breakMinutes} Min`,
                ]
                  .filter(Boolean)
                  .join(", ")} – „${dialog.entry.correction.reason}“`}
                submitLabel={dialog.decision === "APPROVED" ? "Übernehmen" : "Ablehnen"}
                danger={dialog.decision === "REJECTED"}
                onClose={() => setDialog(null)}
                onSubmit={async (comment) => {
                  await rosterRequest(`/api/dienstplan/corrections/${dialog.entry.correction!.id}`, {
                    method: "POST",
                    body: { decision: dialog.decision, comment },
                  });
                  done(dialog.decision === "APPROVED" ? "Korrektur übernommen" : "Korrektur abgelehnt");
                  return "";
                }}
              />
            )}
            {dialog?.kind === "unlock" && data?.period && (
              <DecisionDialog
                title="Monat wieder öffnen"
                description="Danach können Zeiten wieder geändert werden. Die Begründung steht im Protokoll."
                submitLabel="Wieder öffnen"
                requireComment
                onClose={() => setDialog(null)}
                onSubmit={async (reason) => {
                  await rosterRequest(`/api/dienstplan/periods/${data.period!.id}`, {
                    method: "POST",
                    body: { action: "unlock", expectedVersion: data.period!.version, reason },
                  });
                  done(`${monthLabel(year, monthNumber)} wieder geöffnet`);
                  return "";
                }}
              />
            )}
          </main>
        );
      }}
    </ModulePageShell>
  );
}
