"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import { useApiData } from "@/app/components/workspace-ui";
import type { RaiWorkplace } from "@/lib/rai-shared";
import { RaiView, meta } from "./rai-data";
import { OverviewView } from "./rai-overview-view";
import { AssessmentView } from "./rai-assessment-view";
import { DueView, ReportsView, downloadRaiReport } from "./rai-due-reports-views";
import { KompassStatisticsView } from "./kompass-statistics";
import { RaiRefreshPopover } from "./rai-refresh-popover";

export default function RaiWorkspace({ view }: { view: RaiView }) {
  const t = useTerms();
  const router = useRouter();
  const current = meta[view];
  const [refreshOpen, setRefreshOpen] = useState(false);
  const rai = useApiData<RaiWorkplace>(view === "assessment" ? null : "/api/rai");
  return (
    <ModulePageShell
      activeModule="rai"
      activeChild={current.child}
      pageClass={`rai-page rai-${view}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <>
          <main className="workspace module-workspace rai-workspace">
            <section className="page-heading care-page-heading" aria-labelledby="rai-title">
              <div className="heading-copy">
                <p className="eyebrow">CareOS Kompass</p>
                <h1 id="rai-title">{current.title}</h1>
                <p>{current.description.replace("Bewohner", t.prefix)}</p>
              </div>
              {view !== "assessment" && (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() =>
                    view === "overview"
                      ? router.push("/c/kompass/abklaerung")
                      : view === "due"
                        ? setRefreshOpen(true)
                        : downloadRaiReport()
                  }
                >
                  <ModuleIcon name={view === "overview" ? "plus" : "check"} className="button-icon" />
                  {current.action}
                </button>
              )}
            </section>
            {view === "overview" && <OverviewView rai={rai} />}
            {view === "assessment" && <AssessmentView showToast={showToast} />}
            {view === "due" && <DueView rai={rai} />}
            {view === "reports" && (
              <>
                <ReportsView rai={rai} />
                <KompassStatisticsView rai={rai} />
              </>
            )}
          </main>
          {refreshOpen && rai.data && (
            <RaiRefreshPopover
              workplace={rai.data}
              onClose={() => setRefreshOpen(false)}
              onDone={rai.reload}
              showToast={showToast}
            />
          )}
        </>
      )}
    </ModulePageShell>
  );
}
