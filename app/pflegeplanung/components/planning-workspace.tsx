"use client";

import { Suspense } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import EvaluationView from "./evaluation-view";
import GoalsView from "./goals-view";
import PlanView from "./plan-view";
import TemplatesView from "./templates-view";

export type PlanningView = "overview" | "goals" | "evaluation" | "templates";
const navigationLabel: Record<PlanningView, string> = {
  overview: "Pflegeplanung",
  goals: "Ziele & Massnahmen",
  evaluation: "Auswertung",
  templates: "Vorlagen",
};

export default function PlanningWorkspace({ view }: { view: PlanningView }) {
  return (
    <ModulePageShell
      activeModule="plan"
      activeChild={navigationLabel[view]}
      pageClass={`planning-page planning-${view}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace planning-workspace">
          {view === "overview" && (
            // PlanView reads ?resident= (useSearchParams), which needs a Suspense boundary on a static page.
            <Suspense fallback={<p className="list-hint">Pflegeplanung wird geladen …</p>}>
              <PlanView showToast={showToast} />
            </Suspense>
          )}
          {view === "goals" && <GoalsView showToast={showToast} />}
          {view === "evaluation" && <EvaluationView />}
          {view === "templates" && <TemplatesView showToast={showToast} />}
        </main>
      )}
    </ModulePageShell>
  );
}
