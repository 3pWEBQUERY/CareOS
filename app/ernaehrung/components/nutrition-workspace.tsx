"use client";

import ModulePageShell from "@/app/components/module-page-shell";
import FluidsView from "./fluids-view";
import PlanView from "./plan-view";

export type NutritionView = "plan" | "fluids";

export default function NutritionWorkspace({ view }: { view: NutritionView }) {
  return (
    <ModulePageShell
      activeModule="nutrition"
      activeChild={view === "plan" ? "Ernährungsplan" : "Trinkprotokoll"}
      pageClass={`nutrition-page nutrition-${view}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace nutrition-workspace">
          {view === "plan" ? <PlanView showToast={showToast} /> : <FluidsView showToast={showToast} />}
        </main>
      )}
    </ModulePageShell>
  );
}
