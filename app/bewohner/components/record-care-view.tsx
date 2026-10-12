"use client";

import { useRouter } from "next/navigation";
import { CalendarDots, Check, ClipboardText, Heartbeat, ListChecks, Pulse, User, Warning } from "@phosphor-icons/react";
import { setCareResident } from "@/app/components/care-context";
import { formatDate, formatDateTime } from "@/app/components/workspace-ui";
import { RecordCareProcess } from "./record-care-process";
import type { ResidentRecordState } from "./use-resident-record";

const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function RecordCareView({ r }: { r: ResidentRecordState }) {
  const { resident, contentRef, setActiveCareDomainId, activeCareDomain, careDomains, live, latestAssessments } = r;
  const router = useRouter();
  const care = live.care.data;
  const plan = care?.plan ?? null;
  const activeGoals = (plan?.goals ?? []).filter((goal) => goal.status === "active");
  const activeMeasures = activeGoals.reduce(
    (sum, goal) => sum + goal.interventions.filter((item) => item.status === "active").length,
    0,
  );
  const risks = (care?.flags ?? []).filter((flag) => flag.severity !== "info");
  const nextEvaluation =
    [plan?.reviewOn, ...activeGoals.map((goal) => goal.targetDate)]
      .filter((day): day is string => Boolean(day))
      .sort()[0] ?? null;
  const planState = !plan
    ? "Kein Pflegeplan"
    : plan.status === "draft"
      ? "Entwurf"
      : plan.reviewDue || activeGoals.some((goal) => goal.reviewDue)
        ? "Evaluation fällig"
        : "Aktuell";
  const openModule = (href: string) => {
    if (resident.id) setCareResident(resident.id);
    router.push(href);
  };
  const planningHref = `/c/pflegeplanung${resident.id ? `?resident=${resident.id}` : ""}`;
  const loading = live.care.loading && !care;

  return (
    <main className="resident-record-content record-care-view" ref={contentRef} key="care-record">
      <div className="care-record-page-heading">
        <div>
          <span className="record-section-label">Pflegeakte</span>
          <h3>Pflegeprofil</h3>
          <p>Pflegerelevante Ressourcen, Risiken, Ziele und Massnahmen für {resident.name}.</p>
        </div>
        <div className="care-record-heading-actions">
          <button className="secondary-button" type="button" onClick={() => openModule("/c/einschaetzungen")}>
            Neue Einschätzung
          </button>
          <button className="primary-button" type="button" onClick={() => openModule(planningHref)}>
            <ClipboardText aria-hidden="true" /> {plan ? "Pflegeplanung öffnen" : "Pflegeplan anlegen"}
          </button>
        </div>
      </div>

      <RecordCareProcess r={r} />

      <section className="care-record-status" aria-label="Status der Pflegeakte">
        <div>
          <span>
            <Check aria-hidden="true" />
          </span>
          <p>
            <small>Pflegeplanung</small>
            <strong>{loading ? "Wird geladen…" : planState}</strong>
          </p>
        </div>
        <div>
          <span>
            <Warning aria-hidden="true" />
          </span>
          <p>
            <small>Offene Risiken</small>
            <strong>{risks.length} in Beobachtung</strong>
          </p>
        </div>
        <div>
          <span>
            <ClipboardText aria-hidden="true" />
          </span>
          <p>
            <small>Aktive Massnahmen</small>
            <strong>{activeMeasures} geplant</strong>
          </p>
        </div>
        <div>
          <span>
            <CalendarDots aria-hidden="true" />
          </span>
          <p>
            <small>Nächste Evaluation</small>
            <strong>{nextEvaluation ? formatDate(nextEvaluation) : "Nicht festgelegt"}</strong>
          </p>
        </div>
      </section>

      <div className="care-record-layout">
        <div className="care-record-primary">
          <section className="record-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Pflegeprofil</span>
                <h3>Pflegebereiche</h3>
              </div>
              <span>
                {careDomains.length} Bereich{careDomains.length === 1 ? "" : "e"}
              </span>
            </div>
            <div className="care-domain-list">
              {careDomains.map((domain) => (
                <button
                  className={activeCareDomain?.id === domain.id ? "active" : ""}
                  type="button"
                  key={domain.id}
                  aria-pressed={activeCareDomain?.id === domain.id}
                  onClick={() => setActiveCareDomainId(domain.id)}
                >
                  <span className="care-domain-icon">
                    {domain.id.startsWith("Mobil") || domain.id.startsWith("Schlaf") ? (
                      <Pulse aria-hidden="true" />
                    ) : domain.id.startsWith("Ernährung") || domain.id.startsWith("Atmung") ? (
                      <Heartbeat aria-hidden="true" />
                    ) : domain.id.startsWith("Kognition") || domain.id.startsWith("Psyche") ? (
                      <User aria-hidden="true" />
                    ) : (
                      <ClipboardText aria-hidden="true" />
                    )}
                  </span>
                  <span>
                    <strong>{domain.label}</strong>
                    <small>{domain.summary}</small>
                  </span>
                  <span className={`status-badge ${domain.status}`}>{domain.statusLabel}</span>
                </button>
              ))}
              {!loading && !careDomains.length && (
                <p className="body-observation-empty">
                  {plan
                    ? "Der Pflegeplan hat noch keine aktiven Ziele. Ziele und Massnahmen werden in der Pflegeplanung erfasst."
                    : "Noch kein Pflegeplan angelegt. Mit dem Pflegeplan entstehen Pflegebereiche, Ziele und Massnahmen."}
                </p>
              )}
            </div>
          </section>

          {activeCareDomain && (
            <section className="record-card care-domain-detail" aria-live="polite">
              <div className="record-card-heading">
                <div>
                  <span className="record-section-label">Ausgewählter Pflegebereich</span>
                  <h3>{activeCareDomain.label}</h3>
                </div>
                <button type="button" onClick={() => openModule(planningHref)}>
                  Bearbeiten
                </button>
              </div>
              <div className="care-domain-summary">
                <span className={`status-badge ${activeCareDomain.status}`}>{activeCareDomain.statusLabel}</span>
                <p>{activeCareDomain.summary}</p>
              </div>
              <div className="care-goal-grid">
                <section>
                  <span className="care-detail-icon">
                    <Check aria-hidden="true" />
                  </span>
                  <div>
                    <small>Pflegeziel</small>
                    <strong>{activeCareDomain.goal}</strong>
                    <p>
                      {activeCareDomain.targetDate
                        ? `Evaluation am ${formatDate(activeCareDomain.targetDate)}`
                        : "Evaluation nicht festgelegt"}
                    </p>
                  </div>
                </section>
                <section>
                  <span className="care-detail-icon">
                    <ListChecks aria-hidden="true" />
                  </span>
                  <div>
                    <small>Geplante Massnahmen</small>
                    {activeCareDomain.measures.length ? (
                      <ul>
                        {activeCareDomain.measures.map((measure) => (
                          <li key={measure}>{measure}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Noch keine aktiven Massnahmen.</p>
                    )}
                  </div>
                </section>
              </div>
            </section>
          )}
        </div>

        <aside className="care-record-secondary">
          <section className="record-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Prioritäten</span>
                <h3>Aktuell beachten</h3>
              </div>
            </div>
            <div className="care-priority-list">
              {(care?.flags ?? []).map((flag) => (
                <div className={flag.severity === "critical" ? "critical" : "attention"} key={flag.id}>
                  {flag.severity === "critical" ? <Warning aria-hidden="true" /> : <Pulse aria-hidden="true" />}
                  <span>
                    <strong>{flag.label}</strong>
                    <small>{flag.details ?? flag.category}</small>
                  </span>
                </div>
              ))}
              {plan?.focus && (
                <div className="attention">
                  <ClipboardText aria-hidden="true" />
                  <span>
                    <strong>Pflegefokus</strong>
                    <small>{plan.focus}</small>
                  </span>
                </div>
              )}
              {care && !care.flags.length && !plan?.focus && (
                <p className="body-observation-empty">Keine aktiven Hinweise.</p>
              )}
            </div>
          </section>

          <section className="record-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Assessments</span>
                <h3>Aktuelle Einschätzungen</h3>
              </div>
              <button type="button" onClick={() => openModule("/c/einschaetzungen")}>
                Alle anzeigen
              </button>
            </div>
            <div className="care-assessment-list">
              {latestAssessments.map((result) => (
                <div key={result.id}>
                  <span>{result.name}</span>
                  <strong className={result.tone}>
                    {result.riskLabel ?? (result.score !== null ? `Score ${result.score}` : "Erfasst")}
                  </strong>
                  <small>{formatDateTime(result.completedAt)}</small>
                </div>
              ))}
              {!live.care.loading && !latestAssessments.length && (
                <p className="body-observation-empty">Noch keine Einschätzung abgeschlossen.</p>
              )}
            </div>
          </section>

          <section className="record-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Pflegenetzwerk</span>
                <h3>Beteiligte Personen</h3>
              </div>
            </div>
            <div className="care-team-list">
              {(care?.team ?? []).map((person) => (
                <div key={person.name}>
                  <span className="avatar">{initialsOf(person.name)}</span>
                  <p>
                    <strong>{person.name}</strong>
                    <small>{person.role}</small>
                  </p>
                </div>
              ))}
              {live.summary.data?.master.gpName && (
                <div>
                  <span className="avatar">
                    {initialsOf(live.summary.data.master.gpName.replace(/^Dr\.( med\.)? /, ""))}
                  </span>
                  <p>
                    <strong>{live.summary.data.master.gpName}</strong>
                    <small>
                      Hausarzt{live.summary.data.master.gpPractice ? ` · ${live.summary.data.master.gpPractice}` : ""}
                    </small>
                  </p>
                </div>
              )}
              {care && !care.team.length && !live.summary.data?.master.gpName && (
                <p className="body-observation-empty">Noch keine Bezugspflege, Kontakte oder Hausarzt erfasst.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
