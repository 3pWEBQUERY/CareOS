"use client";

import Link from "next/link";
import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EmptyState,
  LoadError,
  PageHeading,
  formatDate,
  todayInZurich,
  useApiData,
} from "@/app/components/workspace-ui";
import type { EvaluationStats } from "@/lib/care-planning-shared";

const RANGES = [
  { days: 30, label: "30 Tage" },
  { days: 90, label: "Quartal" },
  { days: 365, label: "12 Monate" },
];

// Share of evaluations with the goal (at least partially) reached.
const rate = (achieved: number, partially: number, total: number) =>
  total ? Math.round(((achieved + partially * 0.5) / total) * 100) : null;

export default function EvaluationView() {
  const [days, setDays] = useState(90);
  const { data, error, loading, reload } = useApiData<EvaluationStats>(`/api/care-planning/evaluation?days=${days}`);
  const totals = data?.totals;
  const overall = totals ? rate(totals.achieved, totals.partially, totals.evaluations) : null;
  const today = todayInZurich();

  return (
    <>
      <PageHeading
        eyebrow="Pflegeplanung"
        title="Auswertung"
        description="Zielerreichung aus den dokumentierten Evaluationen und anstehende Überprüfungen."
      />
      {error && <LoadError message={error} onRetry={reload} />}
      <div className="planning-evaluation-layout">
        <section className="card planning-evaluation-matrix">
          <div className="planning-board-header">
            <div>
              <p className="eyebrow">Qualitätssicht</p>
              <h2 className="card-title">Zielerreichung nach Pflegebereich</h2>
              <p className="card-subtitle">
                Evaluationen der letzten {days} Tage · teilweise erreicht zählt zur Hälfte
              </p>
            </div>
            <div className="care-record-filters">
              {RANGES.map((range) => (
                <button
                  key={range.days}
                  type="button"
                  className={days === range.days ? "active" : ""}
                  aria-pressed={days === range.days}
                  onClick={() => setDays(range.days)}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          <div className="planning-evaluation-table">
            <div className="planning-evaluation-table-head">
              <span>Pflegebereich</span>
              <span>Evaluationen</span>
              <span>Zielerreichung</span>
              <span>Ergebnisse</span>
            </div>
            {(data?.byCategory ?? []).map((row) => {
              const value = rate(row.achieved, row.partially, row.evaluations);
              return (
                <div className="planning-evaluation-row" key={row.category}>
                  <span>
                    <strong>{row.category}</strong>
                    <small>{row.activeGoals} aktive Ziele</small>
                  </span>
                  <span>{row.evaluations}</span>
                  <span>
                    <strong>{value === null ? "–" : `${value} %`}</strong>
                    <i>
                      <em style={{ width: `${value ?? 0}%` }} />
                    </i>
                  </span>
                  <span className="care-outcome-counts">
                    {(
                      [
                        [row.achieved, "erreicht", "stable"],
                        [row.partially, "teilweise", "info"],
                        [row.notAchieved, "nicht erreicht", "critical"],
                        [row.ongoing, "in Arbeit", ""],
                      ] as const
                    )
                      .filter(([count]) => count > 0)
                      .map(([count, label, tone]) => (
                        <b key={label} className={tone}>
                          {count} {label}
                        </b>
                      ))}
                    {!row.evaluations && <small>keine Evaluation</small>}
                  </span>
                </div>
              );
            })}
            {!loading && !data?.byCategory.length && (
              <EmptyState
                icon="chart"
                title="Noch keine Pflegeziele"
                text="Sobald Ziele evaluiert werden, erscheint hier die Auswertung."
              />
            )}
          </div>
        </section>
        <aside className="planning-evaluation-side">
          <section className="card planning-score-card">
            <p className="eyebrow">Gesamtbild</p>
            <strong>{overall === null ? "–" : `${overall} %`}</strong>
            <span>Zielerreichung</span>
            <div>
              <i style={{ width: `${overall ?? 0}%` }} />
            </div>
            <small>
              {totals ? `${totals.evaluations} Evaluationen · ${totals.activeGoals} aktive Ziele` : "Wird geladen …"}
            </small>
          </section>
          <section className="card planning-review-card care-due-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Nächste 14 Tage</p>
                <h2 className="card-title">Fällige Überprüfungen</h2>
              </div>
            </div>
            <ul>
              {(data?.due ?? []).map((item) => (
                <li key={`${item.kind}-${item.id}`} className={item.date <= today ? "overdue" : ""}>
                  <time>{formatDate(item.date)}</time>
                  <span>
                    <Link href={`/pflegeplanung?resident=${item.residentId}`}>{item.residentName}</Link>
                    <small>
                      {item.kind === "plan" ? <ModuleIcon name="plan" /> : <ModuleIcon name="check" />} {item.title}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
            {!loading && !data?.due.length && (
              <p className="list-hint">Keine Überprüfungen in den nächsten 14 Tagen.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
