"use client";

import ModulePageShell from "@/app/components/module-page-shell";
import ActionsView from "./actions-view";
import EventsView from "./events-view";

export default function QualityWorkspace({ view }: { view: "events" | "actions" }) {
  return (
    <ModulePageShell
      activeModule="quality"
      activeChild={view === "events" ? "Ereignisse" : "Massnahmen"}
      pageClass={`leadership-page leadership-${view === "events" ? "qualityEvents" : "qualityActions"}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace leadership-workspace">
          {view === "events" ? <EventsView showToast={showToast} /> : <ActionsView showToast={showToast} />}
        </main>
      )}
    </ModulePageShell>
  );
}
