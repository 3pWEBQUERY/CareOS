"use client";

import { ModuleIcon } from "@/app/components/module-icon";
import { formatDate, formatDateTime } from "@/app/components/workspace-ui";
import { DAY_PARTS } from "@/lib/intervention-proofs-shared";
import {
  GOAL_STATUS_LABELS,
  INTERVENTION_STATUS_LABELS,
  OUTCOME_LABELS,
  type CareGoal,
  type Intervention,
  type InterventionStatus,
} from "@/lib/care-planning-shared";

export type GoalActions = {
  evaluate: (goal: CareGoal) => void;
  edit: (goal: CareGoal) => void;
  cancel: (goal: CareGoal) => void;
  addIntervention: (goal: CareGoal) => void;
  editIntervention: (goal: CareGoal, intervention: Intervention) => void;
  setInterventionStatus: (intervention: Intervention, status: InterventionStatus) => void;
};

const goalTone = (goal: CareGoal) =>
  goal.status === "achieved" ? "stable" : goal.status !== "active" ? "archived" : goal.reviewDue ? "critical" : "info";

export default function GoalCard({
  goal,
  actions,
  heading,
}: {
  goal: CareGoal;
  actions: GoalActions | null;
  heading?: React.ReactNode;
}) {
  const active = goal.status === "active";
  return (
    <article className={`care-goal ${goal.status}`}>
      {heading}
      <header>
        <span className="care-goal-category">{goal.category}</span>
        <span className={`status-badge ${goalTone(goal)}`}>
          {active
            ? goal.reviewDue
              ? "Überprüfung fällig"
              : `Überprüfung ${formatDate(goal.targetDate)}`
            : GOAL_STATUS_LABELS[goal.status]}
        </span>
      </header>
      <h3>{goal.statement}</h3>
      <dl className="care-goal-context">
        <div>
          <dt>Problem</dt>
          <dd>{goal.problem ?? "Nicht beschrieben"}</dd>
        </div>
        <div>
          <dt>Ressourcen</dt>
          <dd>{goal.resources ?? "Nicht beschrieben"}</dd>
        </div>
      </dl>
      <section className="care-goal-interventions" aria-label="Massnahmen">
        <h4>Massnahmen</h4>
        {goal.interventions.map((intervention) => (
          <div key={intervention.id} className={`care-intervention ${intervention.status}`}>
            <ModuleIcon name="tasks" />
            <span>
              <strong>{intervention.title}</strong>
              <small>
                {[
                  intervention.frequency,
                  intervention.responsibleRole,
                  intervention.dayParts.length
                    ? `Nachweis: ${intervention.dayParts.map((part) => DAY_PARTS[part].label).join(", ")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {intervention.status !== "active" ? ` · ${INTERVENTION_STATUS_LABELS[intervention.status]}` : ""}
              </small>
              {intervention.instructions && <em>{intervention.instructions}</em>}
            </span>
            {actions && active && (
              <span className="care-intervention-actions">
                <button type="button" onClick={() => actions.editIntervention(goal, intervention)}>
                  Bearbeiten
                </button>
                {intervention.status === "active" && (
                  <button type="button" onClick={() => actions.setInterventionStatus(intervention, "paused")}>
                    Pausieren
                  </button>
                )}
                {intervention.status === "paused" && (
                  <button type="button" onClick={() => actions.setInterventionStatus(intervention, "active")}>
                    Fortsetzen
                  </button>
                )}
                {/* Beendete oder abgebrochene Massnahmen lassen sich nur noch bearbeiten. */}
                {(intervention.status === "active" || intervention.status === "paused") && (
                  <button type="button" onClick={() => actions.setInterventionStatus(intervention, "completed")}>
                    Beenden
                  </button>
                )}
              </span>
            )}
          </div>
        ))}
        {!goal.interventions.length && <p className="list-hint">Noch keine Massnahmen geplant.</p>}
      </section>
      {goal.evaluations.length > 0 && (
        <section className="care-goal-evaluations" aria-label="Evaluationen">
          <h4>Evaluationen</h4>
          {goal.evaluations.slice(0, 3).map((evaluation) => (
            <p key={evaluation.id}>
              <strong>{OUTCOME_LABELS[evaluation.outcome]}</strong> · {formatDateTime(evaluation.evaluatedAt)} ·{" "}
              {evaluation.evaluatedBy ?? "unbekannt"}
              <span>{evaluation.note}</span>
            </p>
          ))}
        </section>
      )}
      {actions && active && (
        <footer>
          <button className="primary-button" type="button" onClick={() => actions.evaluate(goal)}>
            Evaluieren
          </button>
          <button className="secondary-button" type="button" onClick={() => actions.addIntervention(goal)}>
            <ModuleIcon name="plus" /> Massnahme
          </button>
          <button className="secondary-button" type="button" onClick={() => actions.edit(goal)}>
            Bearbeiten
          </button>
          <button className="quiet-button" type="button" onClick={() => actions.cancel(goal)}>
            Abbrechen
          </button>
        </footer>
      )}
    </article>
  );
}
