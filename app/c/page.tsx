"use client";

import { type ReactNode } from "react";
import ModulePageShell from "../components/module-page-shell";
import { Icon, DashboardWidgetId } from "./components/dashboard-shared";
import { useDashboard } from "./components/use-dashboard";
import {
  DashboardSummaryStrip,
  DashboardCriticalAlert,
  DashboardTimelineCard,
  DashboardTasksCard,
  DashboardResidentsCard,
} from "./components/dashboard-widgets";
import { DashboardWorklistCard } from "./components/dashboard-worklist";
import { HomeGreetingCard, HomeHero, HomeNotesCard, HomeShortcutsCard, HomeTodayCard } from "./components/home-hero";
import { HomeNews } from "./components/home-news";
import { DashboardCustomizer } from "./components/dashboard-customizer";
import { DashboardArea } from "./components/dashboard-frame";
import { GlobalSearchDialog } from "@/app/components/global-search-dialog";
import { NoteViewDialog, NoteEditorDialog } from "./components/note-dialogs";

export default function Home() {
  const r = useDashboard();
  const {
    noteEditor,
    viewingNote,
    searchOpen,
    toast,
    dashboardEditing,
    openSearch,
    closeSearch,
    openNote,
    criticalChange,
  } = r;
  const dashboardContent: Record<DashboardWidgetId, ReactNode> = {
    greeting: <HomeGreetingCard r={r} />,
    shortcuts: <HomeShortcutsCard r={r} />,
    notes: <HomeNotesCard r={r} />,
    today: <HomeTodayCard r={r} />,
    news: <HomeNews r={r} />,
    summary: <DashboardSummaryStrip r={r} />,
    worklist: <DashboardWorklistCard />,
    critical: criticalChange ? <DashboardCriticalAlert r={r} /> : null,
    shift: <DashboardTimelineCard r={r} />,
    tasks: <DashboardTasksCard r={r} />,
    residents: <DashboardResidentsCard r={r} />,
  };

  return (
    <ModulePageShell activeModule="home" pageClass="home-page" onSearch={openSearch}>
      {() => (
        <>
          <main className="workspace home-workspace">
            <HomeHero r={r}>
              <DashboardArea r={r} top className="home-desk-grid" content={dashboardContent} />
            </HomeHero>

            {dashboardEditing && <DashboardCustomizer r={r} />}

            <DashboardArea r={r} top={false} className="dashboard-custom-grid" content={dashboardContent} />
          </main>

          <button
            className="floating-action"
            type="button"
            aria-label="Notiz erstellen"
            onClick={() => openNote("new")}
          >
            <Icon name="plus" />
          </button>

          {searchOpen && <GlobalSearchDialog onClose={closeSearch} />}

          {viewingNote && <NoteViewDialog r={r} />}
          {noteEditor && <NoteEditorDialog r={r} />}

          {toast && (
            <div className="toast" role="status">
              <Icon name="check" />
              {toast}
            </div>
          )}
        </>
      )}
    </ModulePageShell>
  );
}
