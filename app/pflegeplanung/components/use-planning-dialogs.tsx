"use client";

import { useState, type ReactNode } from "react";
import { ReasonDialog, requestJson, type ShowToast } from "@/app/components/workspace-ui";
import {
  INTERVENTION_STATUS_LABELS,
  type CareGoal,
  type CarePlan,
  type Intervention,
} from "@/lib/care-planning-shared";
import type { GoalActions } from "./goal-card";
import { EvaluationDialog, GoalDialog, InterventionDialog, PlanDialog } from "./planning-dialogs";

type Dialog =
  | { kind: "plan"; residentId: string; residentName: string; plan: CarePlan | null }
  | { kind: "closePlan"; plan: CarePlan; residentName: string }
  | { kind: "goal"; planId: string; residentName: string; goal: CareGoal | null }
  | { kind: "cancelGoal"; goal: CareGoal; residentName: string }
  | { kind: "evaluate"; goal: CareGoal; residentName: string }
  | { kind: "intervention"; goal: CareGoal; residentName: string; intervention: Intervention | null }
  | null;

// Dialog state and goal actions shared by the plan view and the goal list.
export function usePlanningDialogs({
  staff,
  showToast,
  onChanged,
  residentNameOf,
}: {
  staff: Array<{ id: string; name: string }>;
  showToast: ShowToast;
  onChanged: () => void;
  residentNameOf: (goal: CareGoal) => string;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const done = (message: string) => {
    setDialog(null);
    showToast(message);
    onChanged();
  };
  const actions: GoalActions = {
    evaluate: (goal) => setDialog({ kind: "evaluate", goal, residentName: residentNameOf(goal) }),
    edit: (goal) => setDialog({ kind: "goal", goal, planId: goal.planId, residentName: residentNameOf(goal) }),
    cancel: (goal) => setDialog({ kind: "cancelGoal", goal, residentName: residentNameOf(goal) }),
    addIntervention: (goal) =>
      setDialog({ kind: "intervention", goal, intervention: null, residentName: residentNameOf(goal) }),
    editIntervention: (goal, intervention) =>
      setDialog({ kind: "intervention", goal, intervention, residentName: residentNameOf(goal) }),
    setInterventionStatus: (intervention, status) =>
      void requestJson(`/api/care-planning/interventions/${intervention.id}`, { method: "PATCH", body: { status } })
        .then(() => done(`${intervention.title}: ${INTERVENTION_STATUS_LABELS[status]}`))
        .catch((error: Error) => showToast(error.message)),
  };

  let dialogs: ReactNode = null;
  if (dialog?.kind === "plan")
    dialogs = (
      <PlanDialog
        residentId={dialog.residentId}
        residentName={dialog.residentName}
        plan={dialog.plan}
        staff={staff}
        onClose={() => setDialog(null)}
        onSaved={done}
      />
    );
  if (dialog?.kind === "closePlan")
    dialogs = (
      <ReasonDialog
        eyebrow={`Pflegeplanung · ${dialog.residentName}`}
        title="Pflegeplan abschliessen"
        description="Der abgeschlossene Plan bleibt mit allen Zielen und Evaluationen erhalten. Danach kann ein neuer Plan angelegt werden."
        label="Grund"
        placeholder="z. B. Neuplanung nach Heimeintrittsassessment, Austritt"
        submitLabel="Abschliessen"
        danger
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          await requestJson(`/api/care-planning/plans/${dialog.plan.id}`, {
            method: "PATCH",
            body: { status: "closed", reason },
          });
          done("Pflegeplan abgeschlossen");
        }}
      />
    );
  if (dialog?.kind === "goal")
    dialogs = (
      <GoalDialog
        planId={dialog.planId}
        goal={dialog.goal}
        residentName={dialog.residentName}
        onClose={() => setDialog(null)}
        onSaved={done}
      />
    );
  if (dialog?.kind === "cancelGoal")
    dialogs = (
      <ReasonDialog
        eyebrow={`Pflegeplanung · ${dialog.residentName}`}
        title="Pflegeziel abbrechen"
        description={dialog.goal.statement}
        label="Grund"
        placeholder="z. B. Ziel nicht mehr relevant nach Spitalaufenthalt"
        submitLabel="Ziel abbrechen"
        danger
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          await requestJson(`/api/care-planning/goals/${dialog.goal.id}`, {
            method: "PATCH",
            body: { status: "cancelled", reason },
          });
          done("Pflegeziel abgebrochen");
        }}
      />
    );
  if (dialog?.kind === "evaluate")
    dialogs = (
      <EvaluationDialog
        goal={dialog.goal}
        residentName={dialog.residentName}
        onClose={() => setDialog(null)}
        onSaved={done}
      />
    );
  if (dialog?.kind === "intervention")
    dialogs = (
      <InterventionDialog
        goal={dialog.goal}
        intervention={dialog.intervention}
        residentName={dialog.residentName}
        onClose={() => setDialog(null)}
        onSaved={done}
      />
    );

  return {
    actions,
    dialogs,
    openPlan: (residentId: string, residentName: string, plan: CarePlan | null) =>
      setDialog({ kind: "plan", residentId, residentName, plan }),
    closePlan: (plan: CarePlan, residentName: string) => setDialog({ kind: "closePlan", plan, residentName }),
    addGoal: (planId: string, residentName: string) => setDialog({ kind: "goal", planId, goal: null, residentName }),
  };
}
