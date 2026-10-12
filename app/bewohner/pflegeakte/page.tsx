"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon, type ModuleIconName } from "@/app/components/module-icon";
import { EmptyState, LoadError, formatDate, useApiData } from "@/app/components/workspace-ui";
import type { CareGoal } from "@/lib/care-planning-shared";
import { RECORD_TONES, type CareRecordDetail, type CareRecordsOverview } from "@/lib/care-records-shared";
import { CareRecordEditor } from "./care-record-editor";
import { useCareResident, useHeaderResident, useTerms } from "@/app/components/care-context";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

const categoryIcons: Record<string, ModuleIconName> = {
  Mobilität: "pulse",
  "Sicherheit & Sturz": "alert",
  "Ernährung & Flüssigkeit": "nutrition",
  "Haut & Wunden": "wounds",
  "Atmung & Kreislauf": "vitals",
  Stoffwechsel: "vitals",
  Schmerz: "assess",
  "Kognition & Kommunikation": "assess",
  "Psyche & Wohlbefinden": "team",
  "Soziales & Beschäftigung": "team",
};

type Domain = { category: string; icon: ModuleIconName; due: boolean; goals: CareGoal[] };

// Care domains are the active goals of the plan grouped by category.
function domainsOf(goals: CareGoal[]): Domain[] {
  const domains = new Map<string, Domain>();
  for (const goal of goals.filter((item) => item.status === "active")) {
    const domain = domains.get(goal.category) ?? {
      category: goal.category,
      icon: categoryIcons[goal.category] ?? "note",
      due: false,
      goals: [],
    };
    domain.goals.push(goal);
    domain.due ||= goal.reviewDue;
    domains.set(goal.category, domain);
  }
  return [...domains.values()];
}

const nextEvaluation = (reviewOn: string | null, goals: CareGoal[]) =>
  [reviewOn, ...goals.filter((goal) => goal.status === "active").map((goal) => goal.targetDate)]
    .filter((day): day is string => Boolean(day))
    .sort()[0] ?? null;

export default function CareRecordsPage() {
  const t = useTerms();
  const [, setSelectedId] = useCareResident();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const overview = useApiData<CareRecordsOverview>("/api/care-records");
  const records = useMemo(() => overview.data?.records ?? [], [overview.data]);
  const { resident: selected, missing } = useHeaderResident(records, overview.loading);
  const detail = useApiData<CareRecordDetail>(selected ? `/api/care-records/${selected.id}` : null);
  const plan = detail.data?.plan ?? null;
  const domains = domainsOf(plan?.goals ?? []);
  const domain = domains.find((item) => item.category === selectedCategory) ?? domains[0] ?? null;
  const evaluation = selected ? nextEvaluation(plan?.reviewOn ?? selected.reviewOn, plan?.goals ?? []) : null;
  const dueRecord = records
    .filter((record) => record.status === "Evaluation fällig")
    .sort((a, b) => (a.reviewOn ?? "9999").localeCompare(b.reviewOn ?? "9999"))[0];
  const canWrite = overview.data?.canWrite ?? false;
  const planningHref = selected ? `/pflegeplanung?resident=${selected.id}` : "/pflegeplanung";

  return (
    <ModulePageShell
      activeModule="residents"
      activeChild="Pflegeakte"
      pageClass="care-records-page"
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace">
          <section className="page-heading care-page-heading" aria-labelledby="care-records-title">
            <div className="heading-copy">
              <p className="eyebrow">CareOS {t.many}</p>
              <h1 id="care-records-title">Pflegeakten</h1>
              <p>Pflegeprofil, Ziele, Massnahmen und Evaluationen des {t.oneGenitive} in der Kopfzeile.</p>
            </div>
            {canWrite && (
              <button className="primary-button" type="button" onClick={() => setEditorOpen(true)}>
                <ModuleIcon name="plus" className="button-icon" />
                Pflegeakte erstellen
              </button>
            )}
          </section>

          {overview.error && <LoadError message={overview.error} onRetry={overview.reload} />}

          {dueRecord && (
            <section className="critical-alert care-evaluation-alert" aria-label="Fällige Pflegeevaluation">
              <span className="critical-symbol">
                <ModuleIcon name="alert" />
              </span>
              <div>
                <strong>
                  Evaluation fällig · {dueRecord.name}
                  {dueRecord.reviewOn ? ` · seit ${formatDate(dueRecord.reviewOn)}` : ""}
                </strong>
                <p>
                  {dueRecord.goalsDue > 0
                    ? `${dueRecord.goalsDue} Pflegeziel${dueRecord.goalsDue === 1 ? " ist" : "e sind"} zur Evaluation fällig.`
                    : "Der Pflegeplan ist zur Überprüfung fällig."}
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setSelectedId(dueRecord.id);
                  setSelectedCategory(null);
                  showToast(`Pflegeakte von ${dueRecord.name} ausgewählt`);
                }}
              >
                Pflegeakte auswählen <ModuleIcon name="chevron" className="button-icon" />
              </button>
            </section>
          )}

          <div className="care-page-layout header-resident-layout">
            {selected && (
              <section className="care-profile-workspace" aria-live="polite">
                <section className="card care-profile-header">
                  <div className="care-profile-identity">
                    <span className="resident-avatar">{selected.initials}</span>
                    <div>
                      <p className="eyebrow">Ausgewählte Pflegeakte</p>
                      <h2>
                        {selected.name} <ResuscitationBadge residentId={selected.id} />
                      </h2>
                      <span>
                        {[selected.room, selected.careUnit, plan?.careLevel ?? selected.careLevel]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </div>
                  <div className="care-profile-actions">
                    <span className={`status-badge ${RECORD_TONES[selected.status]}`}>{selected.status}</span>
                    <Link className="secondary-button" href="/einschaetzungen">
                      Neue Einschätzung
                    </Link>
                    {plan || !canWrite ? (
                      <Link className="primary-button" href={planningHref}>
                        Pflegeplanung öffnen
                      </Link>
                    ) : (
                      <button className="primary-button" type="button" onClick={() => setEditorOpen(true)}>
                        Pflegeakte erstellen
                      </button>
                    )}
                  </div>
                </section>

                {detail.error && <LoadError message={detail.error} onRetry={detail.reload} />}

                <section className="care-record-status" aria-label={`Status der Pflegeakte von ${selected.name}`}>
                  <div>
                    <span>
                      <ModuleIcon name="check" />
                    </span>
                    <p>
                      <small>Aktive Pflegeziele</small>
                      <strong>
                        {selected.activeGoals} in {domains.length} Bereich{domains.length === 1 ? "" : "en"}
                      </strong>
                    </p>
                  </div>
                  <div>
                    <span>
                      <ModuleIcon name="alert" />
                    </span>
                    <p>
                      <small>Offene Risiken</small>
                      <strong>{selected.risks} in Beobachtung</strong>
                    </p>
                  </div>
                  <div>
                    <span>
                      <ModuleIcon name="tasks" />
                    </span>
                    <p>
                      <small>Aktive Massnahmen</small>
                      <strong>{selected.activeInterventions} geplant</strong>
                    </p>
                  </div>
                  <div>
                    <span>
                      <ModuleIcon name="calendar" />
                    </span>
                    <p>
                      <small>Nächste Evaluation</small>
                      <strong>{evaluation ? formatDate(evaluation) : "Nicht festgelegt"}</strong>
                    </p>
                  </div>
                </section>

                <div className="care-profile-grid">
                  <div className="care-record-primary">
                    <section className="card">
                      <div className="card-header">
                        <div>
                          <p className="eyebrow">Pflegeprofil</p>
                          <h2 className="card-title">Pflegebereiche</h2>
                          <p className="card-subtitle">
                            {plan
                              ? `${domains.length} Bereich${domains.length === 1 ? "" : "e"} der aktuellen Pflegeplanung`
                              : "Noch keine Pflegeplanung"}
                          </p>
                        </div>
                      </div>
                      {domains.length > 0 ? (
                        <div className="care-domain-list">
                          {domains.map((item) => (
                            <button
                              className={domain?.category === item.category ? "active" : ""}
                              type="button"
                              key={item.category}
                              aria-pressed={domain?.category === item.category}
                              onClick={() => setSelectedCategory(item.category)}
                            >
                              <span className="care-domain-icon">
                                <ModuleIcon name={item.icon} />
                              </span>
                              <span>
                                <strong>{item.category}</strong>
                                <small>{item.goals[0].problem ?? item.goals[0].statement}</small>
                              </span>
                              <span className={`status-badge ${item.due ? "attention" : "stable"}`}>
                                {item.due ? "Evaluation fällig" : "Aktiv"}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <EmptyState
                          icon="plan"
                          title={
                            detail.loading
                              ? "Pflegeakte wird geladen …"
                              : plan
                                ? "Noch keine aktiven Pflegeziele"
                                : `Keine Pflegeakte für ${selected.name}`
                          }
                          text={
                            plan
                              ? "Ziele und Massnahmen werden in der Pflegeplanung erfasst."
                              : detail.data?.closedPlans
                                ? `${detail.data.closedPlans} abgeschlossene Planung${detail.data.closedPlans === 1 ? "" : "en"} im Verlauf.`
                                : "Mit dem Pflegeplan entsteht die Pflegeakte mit Zielen und Massnahmen."
                          }
                        />
                      )}
                    </section>

                    {domain && (
                      <section className="card care-domain-detail">
                        <div className="card-header">
                          <div>
                            <p className="eyebrow">Ausgewählter Pflegebereich</p>
                            <h2 className="card-title">{domain.category}</h2>
                          </div>
                          <Link className="quiet-button" href={planningHref}>
                            Bearbeiten
                          </Link>
                        </div>
                        {domain.goals.map((goal) => (
                          <div key={goal.id}>
                            {goal.problem && (
                              <div className="care-domain-summary">
                                <span className={`status-badge ${goal.reviewDue ? "attention" : "stable"}`}>
                                  {goal.reviewDue ? "Evaluation fällig" : "Aktiv"}
                                </span>
                                <p>{goal.problem}</p>
                              </div>
                            )}
                            <div className="care-goal-grid">
                              <section>
                                <span className="care-detail-icon">
                                  <ModuleIcon name="check" />
                                </span>
                                <div>
                                  <small>Pflegeziel</small>
                                  <strong>{goal.statement}</strong>
                                  <p>
                                    Evaluation: {goal.targetDate ? formatDate(goal.targetDate) : "nicht festgelegt"}
                                    {goal.evaluations[0] && ` · zuletzt ${formatDate(goal.evaluations[0].evaluatedAt)}`}
                                  </p>
                                </div>
                              </section>
                              <section>
                                <span className="care-detail-icon">
                                  <ModuleIcon name="tasks" />
                                </span>
                                <div>
                                  <small>Geplante Massnahmen</small>
                                  {goal.interventions.some((item) => item.status === "active") ? (
                                    <ul>
                                      {goal.interventions
                                        .filter((item) => item.status === "active")
                                        .map((item) => (
                                          <li key={item.id}>
                                            {item.title}
                                            {item.frequency ? ` · ${item.frequency}` : ""}
                                          </li>
                                        ))}
                                    </ul>
                                  ) : (
                                    <p>Noch keine aktiven Massnahmen.</p>
                                  )}
                                </div>
                              </section>
                            </div>
                          </div>
                        ))}
                      </section>
                    )}
                  </div>

                  <aside className="care-record-secondary">
                    <section className="card">
                      <div className="card-header">
                        <div>
                          <p className="eyebrow">Prioritäten</p>
                          <h2 className="card-title">Aktuell beachten</h2>
                        </div>
                      </div>
                      <div className="care-priority-list">
                        {(detail.data?.flags ?? []).map((flag) => (
                          <div className={flag.severity === "critical" ? "critical" : "attention"} key={flag.id}>
                            <ModuleIcon name={flag.severity === "critical" ? "alert" : "pulse"} />
                            <span>
                              <strong>{flag.label}</strong>
                              <small>{flag.details ?? flag.category}</small>
                            </span>
                          </div>
                        ))}
                        {plan?.focus && (
                          <div className="attention">
                            <ModuleIcon name="plan" />
                            <span>
                              <strong>Pflegefokus</strong>
                              <small>{plan.focus}</small>
                            </span>
                          </div>
                        )}
                        {evaluation && (
                          <div className="attention">
                            <ModuleIcon name="calendar" />
                            <span>
                              <strong>Evaluation im Blick</strong>
                              <small>Nächster Termin: {formatDate(evaluation)}</small>
                            </span>
                          </div>
                        )}
                        {detail.data && !detail.data.flags.length && !plan?.focus && !evaluation && (
                          <p className="list-hint">Keine aktiven Hinweise.</p>
                        )}
                      </div>
                    </section>
                    <section className="card">
                      <div className="card-header">
                        <div>
                          <p className="eyebrow">Pflegenetzwerk</p>
                          <h2 className="card-title">Verantwortliche Personen</h2>
                        </div>
                      </div>
                      <div className="care-team-list">
                        {(detail.data?.team ?? []).map((person) => (
                          <div key={person.name}>
                            <span className="avatar">
                              {person.name
                                .split(" ")
                                .map((part) => part[0])
                                .join("")
                                .slice(0, 2)}
                            </span>
                            <p>
                              <strong>{person.name}</strong>
                              <small>{person.role}</small>
                            </p>
                          </div>
                        ))}
                        {detail.data && !detail.data.team.length && (
                          <p className="list-hint">Noch keine Bezugspflege oder Kontaktpersonen hinterlegt.</p>
                        )}
                      </div>
                    </section>
                  </aside>
                </div>
              </section>
            )}
            {!selected && (
              <HeaderResidentHint
                loading={overview.loading}
                missing={missing}
                text={`Die Pflegeakte zeigt Ziele, Massnahmen, Risiken und Verantwortliche des ${t.oneGenitive} in der Kopfzeile.`}
              />
            )}
          </div>
          {editorOpen && (
            <CareRecordEditor
              residents={records}
              staff={overview.data?.staff ?? []}
              initialResidentId={selected?.id ?? null}
              onClose={() => setEditorOpen(false)}
              onCreated={(residentId, message) => {
                setEditorOpen(false);
                setSelectedId(residentId);
                setSelectedCategory(null);
                showToast(message);
                overview.reload();
                detail.reload();
              }}
            />
          )}
        </main>
      )}
    </ModulePageShell>
  );
}
