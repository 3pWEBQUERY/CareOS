"use client";

import { Suspense } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import DocumentationView from "./documentation-view";
import OverviewView from "./overview-view";

type WoundsView = "overview" | "documentation";

export default function WoundsWorkspace({ view }: { view: WoundsView }) {
  return (
    <ModulePageShell
      activeModule="wounds"
      activeChild={view === "overview" ? "Wundübersicht" : "Dokumentation"}
      pageClass={view === "overview" ? "wounds-page" : "wound-documentation-page"}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace wounds-workspace">
          {view === "overview" ? (
            // OverviewView reads the URL (useSearchParams), which needs a Suspense boundary on a static page.
            <Suspense fallback={<p className="list-hint">Wunden werden geladen …</p>}>
              <OverviewView showToast={showToast} />
            </Suspense>
          ) : (
            <DocumentationView showToast={showToast} />
          )}
        </main>
      )}
    </ModulePageShell>
  );
}
