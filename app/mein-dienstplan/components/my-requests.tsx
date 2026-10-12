"use client";

import { useState, type ReactNode } from "react";
import { CalendarPlus, Plus } from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import { rosterRequest, useRosterData } from "@/app/dienstplan/components/roster-api";
import type { RequestItem } from "@/lib/roster/request-service";
import type { SwapView } from "@/lib/roster/swap-service";
import { formatDate } from "@/lib/roster/time";
import {
  EXCLUSION_LABELS,
  PREFERENCE_LABELS,
  PRIORITY_LABELS,
  SWAP_STATUS_LABELS,
  TIME_OFF_STATUS_LABELS,
  WEEKDAY_LABELS,
  type ExclusionCategory,
  type PreferenceKind,
  type Priority,
  type TimeOffStatus,
} from "@/lib/roster/types";
import { AbsenceDialog, PreferenceDialog, TimeOffDialog, type PreferenceValue } from "./request-forms";
import { OpenShiftsCard, type OpenShiftsPayload } from "./open-shifts";

type Preference = PreferenceValue & { id: string; shiftType: string | null; date: string | null; active: boolean };
type Payload = {
  timeOff: RequestItem[];
  absences: RequestItem[];
  preferences: Preference[];
  shiftTypes: Array<{ id: string; code: string; name: string }>;
  swaps: SwapView[];
  corrections: Array<{
    id: string;
    date: string;
    status: string;
    reason: string;
    decisionComment: string | null;
    createdAt: string;
  }>;
  openShifts: OpenShiftsPayload;
  userId: string;
};
type Dialog = { kind: "time-off" | "absence" } | { kind: "preference"; value: Preference | null };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const period = (item: { from: string | null; to: string | null }) =>
  !item.from
    ? ""
    : item.from === item.to || !item.to
      ? formatDate(item.from, true)
      : `${formatDate(item.from)}–${formatDate(item.to, true)}`;
const statusTone = (status: string) =>
  status === "APPROVED" || status === "EXECUTED"
    ? "ok"
    : status === "OPEN" || status.startsWith("PENDING")
      ? "attention"
      : status === "REJECTED" || status === "DECLINED" || status === "FAILED"
        ? "critical"
        : "";

export function describePreference(p: {
  kind: string;
  shiftType: string | null;
  weekday: number | null;
  category: string | null;
}) {
  const label = PREFERENCE_LABELS[p.kind as PreferenceKind] ?? p.kind;
  const detail = p.shiftType
    ? p.shiftType
    : p.weekday
      ? WEEKDAY_LABELS[p.weekday - 1]
      : p.category
        ? EXCLUSION_LABELS[p.category as ExclusionCategory]
        : "";
  return detail ? `${label}: ${detail}` : label;
}

// Anträge (Spec 8.6/8.7/8.8): Wunschfrei, Abwesenheiten, Dienstwünsche, Tausch und Korrekturen.
export default function MyRequests() {
  const { data, error, loading, reload } = useRosterData<Payload>("/api/dienstplan/me/requests");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <ModulePageShell pageClass="roster-page">
      {(showToast) => {
        const act = async (key: string, url: string, body: unknown, success: string, method = "POST") => {
          setBusy(key);
          try {
            await rosterRequest(url, { method, body });
            showToast(success);
          } catch (cause) {
            showToast(cause instanceof Error ? cause.message : "Aktion fehlgeschlagen.");
          } finally {
            setBusy(null);
            reload();
          }
        };
        const finish = (message: string) => {
          setDialog(null);
          showToast(message);
          reload();
        };
        const incoming = data?.swaps.filter((s) => s.mine === "target" && s.status === "PENDING_TARGET") ?? [];
        const otherSwaps = data?.swaps.filter((s) => !incoming.includes(s)) ?? [];
        return (
          <main className="workspace roster-workspace">
            <header className="page-heading roster-heading">
              <div className="heading-copy">
                <p className="eyebrow">Mein Dienst · Dienstplan</p>
                <h1>Anträge</h1>
                <p>Wunschfrei, Abwesenheiten, Dienstwünsche, Tausch und Zeitkorrekturen mit ihrem aktuellen Stand.</p>
              </div>
              <div className="roster-heading-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setDialog({ kind: "preference", value: null })}
                  disabled={!data}
                >
                  <Plus className="button-icon" /> Dienstwunsch
                </button>
                <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "absence" })}>
                  Abwesenheit melden
                </button>
                <button className="primary-button" type="button" onClick={() => setDialog({ kind: "time-off" })}>
                  <CalendarPlus className="button-icon" /> Wunschfrei
                </button>
              </div>
            </header>
            {error && <p className="roster-alert">{error.message}</p>}
            {loading && !data ? (
              <section className="card roster-card">
                <div className="roster-skeleton">
                  {Array.from({ length: 6 }, (_, i) => (
                    <span key={i} />
                  ))}
                </div>
              </section>
            ) : (
              data && (
                <>
                  {incoming.length > 0 && (
                    <section className="card roster-card">
                      <div className="roster-section-head">
                        <div>
                          <h2>Tauschanfragen an dich</h2>
                          <p>Mit „Annehmen“ wird der Tausch geprüft und – je nach Regelwerk – sofort ausgeführt.</p>
                        </div>
                      </div>
                      <div className="roster-table-wrap">
                        <table className="roster-table">
                          <thead>
                            <tr>
                              <th>Von</th>
                              <th>Dienst</th>
                              <th>Dein Gegendienst</th>
                              <th>Nachricht</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {incoming.map((swap) => (
                              <tr key={swap.id}>
                                <td>{swap.requester}</td>
                                <td>{swap.sourceShift}</td>
                                <td>{swap.targetShift ?? "Übernahme ohne Gegendienst"}</td>
                                <td>{swap.message ?? ""}</td>
                                <td>
                                  <div className="roster-row-actions">
                                    <button
                                      className="secondary-button"
                                      type="button"
                                      disabled={busy === swap.id}
                                      onClick={() =>
                                        act(
                                          swap.id,
                                          `/api/dienstplan/swaps/${swap.id}`,
                                          { action: "decline" },
                                          "Tausch abgelehnt",
                                        )
                                      }
                                    >
                                      Ablehnen
                                    </button>
                                    <button
                                      className="primary-button"
                                      type="button"
                                      disabled={busy === swap.id}
                                      onClick={() =>
                                        act(
                                          swap.id,
                                          `/api/dienstplan/swaps/${swap.id}`,
                                          { action: "accept" },
                                          "Tausch angenommen",
                                        )
                                      }
                                    >
                                      Annehmen
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  <OpenShiftsCard data={data.openShifts} busy={busy} act={act} />

                  <RequestTable
                    title="Wunschfrei"
                    description="Genehmigtes Wunschfrei berücksichtigt die Planung wie eine Abwesenheit."
                    empty="Noch kein Wunschfrei beantragt."
                    items={data.timeOff}
                    extra={(item) => (item.priority ? PRIORITY_LABELS[item.priority as Priority] : "")}
                    extraLabel="Priorität"
                    action={(item) =>
                      item.status === "OPEN" && (
                        <div className="roster-row-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={busy === item.id}
                            onClick={() =>
                              act(
                                item.id,
                                `/api/dienstplan/time-off/${item.id}`,
                                { action: "withdraw" },
                                "Antrag zurückgezogen",
                              )
                            }
                          >
                            Zurückziehen
                          </button>
                        </div>
                      )
                    }
                  />
                  <RequestTable
                    title="Abwesenheiten"
                    description="Ferien, Weiterbildung und Termine brauchen eine Bewilligung; Krankmeldungen gelten sofort."
                    empty="Keine Abwesenheiten erfasst."
                    items={data.absences}
                    action={(item) =>
                      item.status === "OPEN" && (
                        <div className="roster-row-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={busy === item.id}
                            onClick={() =>
                              act(
                                item.id,
                                `/api/dienstplan/absences/${item.id}`,
                                { action: "withdraw" },
                                "Antrag zurückgezogen",
                              )
                            }
                          >
                            Zurückziehen
                          </button>
                        </div>
                      )
                    }
                  />

                  <section className="card roster-card">
                    <div className="roster-section-head">
                      <div>
                        <h2>Tausch</h2>
                        <p>Deine Tauschanfragen und ihr Stand.</p>
                      </div>
                    </div>
                    <div className="roster-table-wrap">
                      <table className="roster-table">
                        <thead>
                          <tr>
                            <th>Mit</th>
                            <th>Dienst</th>
                            <th>Gegendienst</th>
                            <th>Status</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {otherSwaps.map((swap) => (
                            <tr key={swap.id}>
                              <td>{swap.mine === "requester" ? swap.target : swap.requester}</td>
                              <td>{swap.sourceShift}</td>
                              <td>{swap.targetShift ?? "Übernahme"}</td>
                              <td>
                                <span className={`roster-pill ${statusTone(swap.status)}`}>
                                  {SWAP_STATUS_LABELS[swap.status]}
                                </span>
                                {swap.failureMessage && <small className="roster-muted"> {swap.failureMessage}</small>}
                              </td>
                              <td>
                                {swap.mine === "requester" && swap.status === "PENDING_TARGET" && (
                                  <div className="roster-row-actions">
                                    <button
                                      className="secondary-button"
                                      type="button"
                                      disabled={busy === swap.id}
                                      onClick={() =>
                                        act(
                                          swap.id,
                                          `/api/dienstplan/swaps/${swap.id}`,
                                          { action: "withdraw" },
                                          "Anfrage zurückgezogen",
                                        )
                                      }
                                    >
                                      Zurückziehen
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                          {!otherSwaps.length && (
                            <tr>
                              <td colSpan={5} className="roster-muted">
                                Noch keine Tauschanfragen. Einen Tausch fragst du in „Meine Dienste“ am jeweiligen
                                Dienst an.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="card roster-card">
                    <div className="roster-section-head">
                      <div>
                        <h2>Dienstwünsche</h2>
                        <p>Weiche Wünsche für die Planung, z. B. bevorzugte Dienste oder Tage ohne Dienst.</p>
                      </div>
                    </div>
                    <div className="roster-table-wrap">
                      <table className="roster-table">
                        <thead>
                          <tr>
                            <th>Wunsch</th>
                            <th>Gültig</th>
                            <th>Kommentar</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {data.preferences.map((pref) => (
                            <tr key={pref.id}>
                              <td>
                                {describePreference(pref)}
                                {!pref.active && <span className="roster-pill"> inaktiv</span>}
                              </td>
                              <td>
                                {pref.validFrom || pref.validUntil
                                  ? `${pref.validFrom ? formatDate(pref.validFrom, true) : "…"}–${pref.validUntil ? formatDate(pref.validUntil, true) : "…"}`
                                  : "unbefristet"}
                              </td>
                              <td>{pref.comment ?? ""}</td>
                              <td>
                                <div className="roster-row-actions">
                                  <button
                                    className="secondary-button"
                                    type="button"
                                    onClick={() => setDialog({ kind: "preference", value: pref })}
                                  >
                                    Bearbeiten
                                  </button>
                                  <button
                                    className="appointment-danger-button"
                                    type="button"
                                    disabled={busy === pref.id}
                                    onClick={() =>
                                      act(
                                        pref.id,
                                        `/api/dienstplan/preferences/${pref.id}`,
                                        undefined,
                                        "Dienstwunsch gelöscht",
                                        "DELETE",
                                      )
                                    }
                                  >
                                    Löschen
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {!data.preferences.length && (
                            <tr>
                              <td colSpan={4} className="roster-muted">
                                Keine Dienstwünsche erfasst.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="card roster-card">
                    <div className="roster-section-head">
                      <div>
                        <h2>Zeitkorrekturen</h2>
                        <p>Beantragte Korrekturen deiner erfassten Zeiten.</p>
                      </div>
                    </div>
                    <div className="roster-table-wrap">
                      <table className="roster-table">
                        <thead>
                          <tr>
                            <th>Datum</th>
                            <th>Begründung</th>
                            <th>Status</th>
                            <th>Rückmeldung</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.corrections.map((c) => (
                            <tr key={c.id}>
                              <td>{formatDate(c.date, true)}</td>
                              <td>{c.reason}</td>
                              <td>
                                <span className={`roster-pill ${statusTone(c.status)}`}>
                                  {TIME_OFF_STATUS_LABELS[c.status as TimeOffStatus] ?? c.status}
                                </span>
                              </td>
                              <td>{c.decisionComment ?? ""}</td>
                            </tr>
                          ))}
                          {!data.corrections.length && (
                            <tr>
                              <td colSpan={4} className="roster-muted">
                                Keine Korrekturen beantragt. Eine Korrektur beantragst du unter „Zeiten“.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )
            )}
            {dialog?.kind === "time-off" && (
              <TimeOffDialog today={today()} onClose={() => setDialog(null)} onDone={finish} />
            )}
            {dialog?.kind === "absence" && (
              <AbsenceDialog today={today()} onClose={() => setDialog(null)} onDone={finish} />
            )}
            {dialog?.kind === "preference" && data && (
              <PreferenceDialog
                shiftTypes={data.shiftTypes}
                initial={dialog.value}
                onClose={() => setDialog(null)}
                onDone={finish}
              />
            )}
          </main>
        );
      }}
    </ModulePageShell>
  );
}

export function RequestTable({
  title,
  description,
  empty,
  items,
  showEmployee,
  extra,
  extraLabel,
  action,
}: {
  title: string;
  description: string;
  empty: string;
  items: RequestItem[];
  showEmployee?: boolean;
  extra?: (item: RequestItem) => string;
  extraLabel?: string;
  action?: (item: RequestItem) => ReactNode;
}) {
  const columns = 4 + (showEmployee ? 1 : 0) + (extra ? 1 : 0) + (action ? 1 : 0);
  return (
    <section className="card roster-card">
      <div className="roster-section-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="roster-table-wrap">
        <table className="roster-table">
          <thead>
            <tr>
              {showEmployee && <th>Person</th>}
              <th>Zeitraum</th>
              <th>Art</th>
              {extra && <th>{extraLabel}</th>}
              <th>Status</th>
              <th>Kommentar</th>
              {action && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                {showEmployee && <td>{item.employee}</td>}
                <td>{period(item)}</td>
                <td>{item.label}</td>
                {extra && <td>{extra(item)}</td>}
                <td>
                  <span className={`roster-pill ${statusTone(item.status)}`}>
                    {TIME_OFF_STATUS_LABELS[item.status as TimeOffStatus] ?? item.status}
                  </span>
                </td>
                <td>
                  {item.comment ?? ""}
                  {item.decisionComment && <small className="roster-muted"> · Leitung: {item.decisionComment}</small>}
                </td>
                {action && <td>{action(item)}</td>}
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={columns} className="roster-muted">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
