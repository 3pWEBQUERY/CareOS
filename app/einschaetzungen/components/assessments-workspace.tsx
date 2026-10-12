"use client";

import ModulePageShell from "@/app/components/module-page-shell";
import { OverviewView } from "./assessment-views";
import { DueView } from "./assessment-due-view";

export default function AssessmentsWorkspace({ view }: { view: "overview" | "due" }) {
  return (
    <ModulePageShell
      activeModule="assess"
      activeChild={view === "overview" ? "Einschätzungen" : "Fälligkeiten"}
      pageClass="operations-page assessments-page"
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace operations-workspace">
          {view === "overview" ? <OverviewView showToast={showToast} /> : <DueView showToast={showToast} />}
        </main>
      )}
    </ModulePageShell>
  );
}
