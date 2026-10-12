"use client";

import ModulePageShell from "@/app/components/module-page-shell";
import DevelopmentView from "./development-view";
import OverviewView from "./overview-view";
import ThresholdsView from "./thresholds-view";

type VitalsView = "overview" | "development" | "thresholds";
const navigationLabel: Record<VitalsView, string> = {
  overview: "Übersicht",
  development: "Entwicklung",
  thresholds: "Grenzwerte",
};

export default function VitalsWorkspace({ view }: { view: VitalsView }) {
  return (
    <ModulePageShell
      activeModule="vitals"
      activeChild={navigationLabel[view]}
      pageClass={`vitals-page vitals-${view}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className={`workspace module-workspace ${view === "overview" ? "" : "vitals-secondary-workspace"}`}>
          {view === "overview" && <OverviewView showToast={showToast} />}
          {view === "development" && <DevelopmentView />}
          {view === "thresholds" && <ThresholdsView showToast={showToast} />}
        </main>
      )}
    </ModulePageShell>
  );
}
