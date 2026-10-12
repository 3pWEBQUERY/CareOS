"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ModulePageShell from "@/app/components/module-page-shell";
import { describePreference, RequestTable } from "@/app/mein-dienstplan/components/my-requests";
import { DecisionDialog } from "@/app/mein-dienstplan/components/request-forms";
import type { RequestItem } from "@/lib/roster/request-service";
import type { SwapView } from "@/lib/roster/swap-service";
import { formatDate, localTime } from "@/lib/roster/time";
import { PRIORITY_LABELS, SWAP_STATUS_LABELS, type Priority, type RuleCode, type Violation } from "@/lib/roster/types";
import { RosterRequestError, rosterRequest, useRosterData } from "./roster-api";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import {
  OPEN_SHIFTS_PREVIEW,
  ShowAllOpenShifts,
  shiftLabel,
  type OpenShiftsPayload,
} from "@/app/mein-dienstplan/components/open-shifts";

type Payload = {
  timeOff: RequestItem[];
  absences: RequestItem[];
  preferences: Array<{
    id: string;
    employee: string;
    kind: string;
    shiftType: string | null;
    weekday: number | null;
    category: string | null;
    date: string | null;
    comment: string | null;
  }>;
  swaps: SwapView[];
  corrections: Array<{
    id: string;
    employee: string;
    date: string;
    reason: string;
    current: { clockIn: string | null; clockOut: string | null; breakMinutes: number };
    requested: { clockIn: string | null; clockOut: string | null; breakMinutes: number | null };
    createdAt: string;
  }>;
  openShifts: OpenShiftsPayload;
};
type Units = { units: Array<{ id: string; name: string; lead: boolean }> };
type Decision = {
  title: string;
  description: string;
  submitLabel: string;
  danger?: boolean;
  requireComment?: boolean;
  violations?: Violation[];
  // Bestätigte Warnungen (zweiter Durchlauf nach CONFIRMATION_REQUIRED).
  acknowledge?: RuleCode[];
  run: (comment: string) => Promise<string>;
};

const TZ = "Europe/Zurich";
const times = (value: { clockIn: string | null; clockOut: string | null; breakMinutes: number | null }) =>
  [
    value.clockIn ? localTime(value.clockIn, TZ) : "…",
    "–",
    value.clockOut ? localTime(value.clockOut, TZ) : "…",
    value.breakMinutes !== null ? ` · Pause ${value.breakMinutes} Min` : "",
  ].join("");

// Anträge der Leitung (Spec 8.6–8.8, 8.10): entscheiden mit Kommentar; Konflikte werden angezeigt.
export default function RequestsWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const unitParam = params.get("einheit");
  const { data, error, loading, reload } = useRosterData<Payload>(
    `/api/dienstplan/requests${unitParam ? `?einheit=${unitParam}` : ""}`,
  );
  const settings = useRosterData<Units>("/api/dienstplan/settings");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [allOpenShifts, setAllOpenShifts] = useState(false);
  // Wird vor jedem Absenden gesetzt; post() hängt bestätigte Warnungen samt Begründung an.
  const ack = useRef<{ acknowledgedWarnings?: RuleCode[]; overrideReason?: string }>({});
  const leadUnits = settings.data?.units.filter((u) => u.lead) ?? [];

  return (
    <ModulePageShell pageClass="roster-page">
      {(showToast) => {
        const decide = (next: Decision) => setDecision(next);
        const post = (url: string, body: Record<string, unknown>) =>
          rosterRequest(url, { method: "POST", body: { ...body, ...ack.current } });

        const approveTimeOff = (item: RequestItem): Decision => ({
          title: "Wunschfrei genehmigen",
          description: `${item.employee}: ${item.from === item.to ? formatDate(item.from!, true) : `${formatDate(item.from!)}–${formatDate(item.to!, true)}`}`,
          submitLabel: "Genehmigen",
          run: async (comment) => {
            try {
              await post(`/api/dienstplan/time-off/${item.id}`, { decision: "APPROVED", comment });
              return "Wunschfrei genehmigt";
            } catch (cause) {
              if (!(cause instanceof RosterRequestError) || cause.code !== "HAS_SHIFTS") throw cause;
              // Konflikt: bestehende Dienste zeigen und explizit bestätigen lassen.
              setDecision({
                title: "Dienste im Zeitraum",
                description: `${cause.message} Beim Genehmigen werden diese Dienste entfernt (im Protokoll festgehalten).`,
                submitLabel: "Dienst entfernen und genehmigen",
                danger: true,
                run: async (again) => {
                  await post(`/api/dienstplan/time-off/${item.id}`, {
                    decision: "APPROVED",
                    comment: again || comment,
                    removeShifts: true,
                  });
                  return "Wunschfrei genehmigt, Dienste entfernt";
                },
              });
              return "";
            }
          },
        });
        const reject = (url: string, label: string, body: Record<string, unknown> = {}): Decision => ({
          title: `${label} ablehnen`,
          description: "Die Person wird mit deinem Kommentar benachrichtigt.",
          submitLabel: "Ablehnen",
          danger: true,
          run: async (comment) => {
            await post(url, { decision: "REJECTED", ...body, comment });
            return `${label} abgelehnt`;
          },
        });

        const pendingSwaps = data?.swaps.filter((s) => s.status === "PENDING_APPROVAL") ?? [];
        // Dienste mit gemeldetem Interesse zuerst (stabile Sortierung behält die Datumsreihenfolge).
        const openShifts = [...(data?.openShifts.shifts ?? [])].sort(
          (a, b) => Number(b.interests.length > 0) - Number(a.interests.length > 0),
        );
        const otherSwaps = data?.swaps.filter((s) => s.status !== "PENDING_APPROVAL") ?? [];
        return (
          <main className="workspace roster-workspace">
            <header className="page-heading roster-heading">
              <div className="heading-copy">
                <p className="eyebrow">Leitung · Dienstplan</p>
                <h1>Anträge</h1>
                <p>Wunschfrei, Abwesenheiten, Tausch und Zeitkorrekturen entscheiden; Dienstwünsche im Überblick.</p>
              </div>
            </header>
            {leadUnits.length > 1 && (
              <section className="roster-toolbar">
                <div className="roster-filters">
                  <CareOptionSelect
                    label="Wohnbereich"
                    value={unitParam ?? ""}
                    onChange={(value) => {
                      const next = new URLSearchParams(params.toString());
                      if (value) next.set("einheit", value);
                      else next.delete("einheit");
                      router.replace(`${pathname}?${next}`, { scroll: false });
                    }}
                    options={[
                      { value: "", label: "Alle meine Wohnbereiche" },
                      ...leadUnits.map((unit) => ({ value: String(unit.id), label: String(unit.name) })),
                    ]}
                  />
                </div>
              </section>
            )}
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
                  <RequestTable
                    title="Wunschfrei"
                    description="Offene Anträge zuerst; entschiedene der letzten 30 Tage."
                    empty="Keine Wunschfrei-Anträge."
                    items={data.timeOff}
                    showEmployee
                    extra={(item) => (item.priority ? PRIORITY_LABELS[item.priority as Priority] : "")}
                    extraLabel="Priorität"
                    action={(item) =>
                      item.status === "OPEN" && (
                        <div className="roster-row-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => decide(reject(`/api/dienstplan/time-off/${item.id}`, "Wunschfrei"))}
                          >
                            Ablehnen
                          </button>
                          <button className="primary-button" type="button" onClick={() => decide(approveTimeOff(item))}>
                            Genehmigen
                          </button>
                        </div>
                      )
                    }
                  />
                  <RequestTable
                    title="Abwesenheiten"
                    description="Bei Bewilligung werden die Abwesenheitsdienste automatisch eingetragen."
                    empty="Keine Abwesenheitsanträge."
                    items={data.absences}
                    showEmployee
                    action={(item) =>
                      item.status === "OPEN" && (
                        <div className="roster-row-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => decide(reject(`/api/dienstplan/absences/${item.id}`, "Abwesenheit"))}
                          >
                            Ablehnen
                          </button>
                          <button
                            className="primary-button"
                            type="button"
                            onClick={() =>
                              decide({
                                title: "Abwesenheit bewilligen",
                                description: `${item.employee}: ${item.label}. Eingeplante Arbeitsdienste im Zeitraum werden ersetzt.`,
                                submitLabel: "Bewilligen",
                                run: async (comment) => {
                                  const result = await post(`/api/dienstplan/absences/${item.id}`, {
                                    decision: "APPROVED",
                                    comment,
                                  });
                                  const created = (result as { created?: number } | null)?.created ?? 0;
                                  return `Abwesenheit bewilligt${created ? ` · ${created} Tage eingetragen` : ""}`;
                                },
                              })
                            }
                          >
                            Bewilligen
                          </button>
                        </div>
                      )
                    }
                  />

                  <section className="card roster-card">
                    <div className="roster-section-head">
                      <div>
                        <h2>Tausch</h2>
                        <p>Beim Genehmigen wird der Tausch erneut gegen alle Regeln geprüft.</p>
                      </div>
                    </div>
                    <div className="roster-table-wrap">
                      <table className="roster-table">
                        <thead>
                          <tr>
                            <th>Anfrage von</th>
                            <th>Dienst</th>
                            <th>An</th>
                            <th>Gegendienst</th>
                            <th>Status</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {[...pendingSwaps, ...otherSwaps].map((swap) => (
                            <tr key={swap.id}>
                              <td>{swap.requester}</td>
                              <td>{swap.sourceShift}</td>
                              <td>{swap.target}</td>
                              <td>{swap.targetShift ?? "Übernahme"}</td>
                              <td>
                                <span
                                  className={`roster-pill ${swap.status === "EXECUTED" ? "ok" : swap.status.startsWith("PENDING") ? "attention" : ""}`}
                                >
                                  {SWAP_STATUS_LABELS[swap.status]}
                                </span>
                                {swap.failureMessage && <small className="roster-muted"> {swap.failureMessage}</small>}
                              </td>
                              <td>
                                {swap.status === "PENDING_APPROVAL" && (
                                  <div className="roster-row-actions">
                                    <button
                                      className="secondary-button"
                                      type="button"
                                      onClick={() =>
                                        decide({
                                          title: "Tausch ablehnen",
                                          description: "Beide Personen werden benachrichtigt.",
                                          submitLabel: "Ablehnen",
                                          danger: true,
                                          run: async (comment) => {
                                            await post(`/api/dienstplan/swaps/${swap.id}`, {
                                              action: "reject",
                                              comment,
                                            });
                                            return "Tausch abgelehnt";
                                          },
                                        })
                                      }
                                    >
                                      Ablehnen
                                    </button>
                                    <button
                                      className="primary-button"
                                      type="button"
                                      onClick={() =>
                                        decide({
                                          title: "Tausch genehmigen",
                                          description: `${swap.sourceShift} ↔ ${swap.targetShift ?? "Übernahme"} (${swap.requester} / ${swap.target})`,
                                          submitLabel: "Genehmigen und ausführen",
                                          run: async () => {
                                            await post(`/api/dienstplan/swaps/${swap.id}`, { action: "approve" });
                                            return "Tausch ausgeführt";
                                          },
                                        })
                                      }
                                    >
                                      Genehmigen
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                          {!data.swaps.length && (
                            <tr>
                              <td colSpan={6} className="roster-muted">
                                Keine Tauschanfragen.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="card roster-card" aria-label="Offene Dienste">
                    <div className="roster-section-head">
                      <div>
                        <h2>Offene Dienste</h2>
                        <p>
                          Fehlende Mindestbesetzung im veröffentlichten Plan. Beim Zuteilen wird der Dienst gegen alle
                          Regeln geprüft.
                        </p>
                      </div>
                    </div>
                    <div className="roster-table-wrap">
                      <table className="roster-table">
                        <thead>
                          <tr>
                            <th>Datum</th>
                            <th>Dienst</th>
                            <th>Wohnbereich</th>
                            <th>Offen</th>
                            <th>Interesse</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(allOpenShifts ? openShifts : openShifts.slice(0, OPEN_SHIFTS_PREVIEW)).map((shift) => (
                            <tr key={shift.key}>
                              <td>{formatDate(shift.date, true)}</td>
                              <td>{shiftLabel(shift)}</td>
                              <td>{shift.unit}</td>
                              <td>
                                {shift.open} von {shift.required}
                              </td>
                              <td>
                                {shift.interests.length ? (
                                  <ul className="roster-open-interests">
                                    {shift.interests.map((interest) => (
                                      <li key={interest.id}>
                                        <span>
                                          <strong>{interest.employee}</strong>
                                          {interest.message ? (
                                            <small className="roster-muted"> „{interest.message}“</small>
                                          ) : null}
                                        </span>
                                        <div className="roster-row-actions">
                                          <button
                                            className="secondary-button"
                                            type="button"
                                            onClick={() =>
                                              decide({
                                                title: "Interesse ablehnen",
                                                description: `${interest.employee} wird mit deinem Kommentar benachrichtigt.`,
                                                submitLabel: "Ablehnen",
                                                danger: true,
                                                run: async (comment) => {
                                                  await post(`/api/dienstplan/open-shifts/${interest.id}`, {
                                                    decision: "DECLINED",
                                                    comment,
                                                  });
                                                  return "Interesse abgelehnt";
                                                },
                                              })
                                            }
                                          >
                                            Ablehnen
                                          </button>
                                          <button
                                            className="primary-button"
                                            type="button"
                                            onClick={() =>
                                              decide({
                                                title: "Dienst zuteilen",
                                                description: `${interest.employee}: ${shiftLabel(shift)} am ${formatDate(shift.date, true)} (${shift.unit})`,
                                                submitLabel: "Zuteilen",
                                                run: async (comment) => {
                                                  await post(`/api/dienstplan/open-shifts/${interest.id}`, {
                                                    decision: "ASSIGNED",
                                                    comment,
                                                  });
                                                  return `Dienst ${interest.employee} zugeteilt`;
                                                },
                                              })
                                            }
                                          >
                                            Zuteilen
                                          </button>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="roster-muted">Noch niemand</span>
                                )}
                              </td>
                            </tr>
                          ))}
                          {!data.openShifts.shifts.length && (
                            <tr>
                              <td colSpan={5} className="roster-muted">
                                Keine offenen Dienste im veröffentlichten Plan.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <ShowAllOpenShifts
                      total={openShifts.length}
                      all={allOpenShifts}
                      onToggle={() => setAllOpenShifts((current) => !current)}
                    />
                  </section>

                  <section className="card roster-card">
                    <div className="roster-section-head">
                      <div>
                        <h2>Zeitkorrekturen</h2>
                        <p>Beantragte Änderungen an erfassten Zeiten.</p>
                      </div>
                    </div>
                    <div className="roster-table-wrap">
                      <table className="roster-table">
                        <thead>
                          <tr>
                            <th>Person</th>
                            <th>Datum</th>
                            <th>Erfasst</th>
                            <th>Beantragt</th>
                            <th>Begründung</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {data.corrections.map((c) => (
                            <tr key={c.id}>
                              <td>{c.employee}</td>
                              <td>{formatDate(c.date, true)}</td>
                              <td>{times(c.current)}</td>
                              <td>{times(c.requested)}</td>
                              <td>{c.reason}</td>
                              <td>
                                <div className="roster-row-actions">
                                  <button
                                    className="secondary-button"
                                    type="button"
                                    onClick={() => decide(reject(`/api/dienstplan/corrections/${c.id}`, "Korrektur"))}
                                  >
                                    Ablehnen
                                  </button>
                                  <button
                                    className="primary-button"
                                    type="button"
                                    onClick={() =>
                                      decide({
                                        title: "Korrektur übernehmen",
                                        description: `${c.employee}, ${formatDate(c.date, true)}: ${times(c.requested)}`,
                                        submitLabel: "Übernehmen",
                                        run: async (comment) => {
                                          await post(`/api/dienstplan/corrections/${c.id}`, {
                                            decision: "APPROVED",
                                            comment,
                                          });
                                          return "Korrektur übernommen";
                                        },
                                      })
                                    }
                                  >
                                    Übernehmen
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {!data.corrections.length && (
                            <tr>
                              <td colSpan={6} className="roster-muted">
                                Keine offenen Korrekturen.
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
                        <p>Aktive Wünsche; die Planung und die KI berücksichtigen sie als weiche Kriterien.</p>
                      </div>
                    </div>
                    <div className="roster-table-wrap">
                      <table className="roster-table">
                        <thead>
                          <tr>
                            <th>Person</th>
                            <th>Wunsch</th>
                            <th>Kommentar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.preferences.map((p) => (
                            <tr key={p.id}>
                              <td>{p.employee}</td>
                              <td>{describePreference(p)}</td>
                              <td>{p.comment ?? ""}</td>
                            </tr>
                          ))}
                          {!data.preferences.length && (
                            <tr>
                              <td colSpan={3} className="roster-muted">
                                Keine aktiven Dienstwünsche.
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
            {decision && (
              <DecisionDialog
                key={decision.title}
                title={decision.title}
                description={decision.description}
                submitLabel={decision.submitLabel}
                danger={decision.danger}
                requireComment={decision.requireComment}
                violations={decision.violations}
                onClose={() => setDecision(null)}
                onSubmit={async (comment) => {
                  ack.current = decision.acknowledge?.length
                    ? { acknowledgedWarnings: decision.acknowledge, overrideReason: comment }
                    : {};
                  try {
                    const message = await decision.run(comment);
                    if (message) {
                      setDecision(null);
                      showToast(message);
                    }
                    return message;
                  } catch (cause) {
                    if (!(cause instanceof RosterRequestError) || cause.code !== "CONFIRMATION_REQUIRED") throw cause;
                    // Warnungen (z. B. Unterbesetzung) anzeigen und mit Begründung bestätigen lassen.
                    setDecision({
                      ...decision,
                      title: "Warnungen bestätigen",
                      description: cause.message,
                      submitLabel: "Trotzdem ausführen",
                      danger: false,
                      requireComment: true,
                      violations: cause.violations,
                      acknowledge: cause.violations.filter((v) => v.severity === "WARN").map((v) => v.code),
                    });
                    return "";
                  } finally {
                    reload();
                  }
                }}
              />
            )}
          </main>
        );
      }}
    </ModulePageShell>
  );
}
