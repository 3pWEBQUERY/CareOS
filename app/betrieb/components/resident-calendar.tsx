"use client";

import { useTerms } from "@/app/components/care-context";
import { Plus } from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import ResidentAppointmentEditor from "@/app/components/resident-appointment-editor";
import { useResidentCalendar } from "./use-resident-calendar";
import { CalendarSummary } from "./resident-calendar-summary";
import { CalendarSidebar } from "./resident-calendar-sidebar";
import { CalendarBoard } from "./resident-calendar-board";

export default function ResidentCalendar() {
  const t = useTerms();
  const r = useResidentCalendar();
  const { residents, careUnits, editor, setEditor, create, saved } = r;
  return (
    <ModulePageShell
      activeModule="one-calendar"
      activeChild="Kalender"
      pageClass="resident-calendar-page"
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {() => (
        <main className="workspace resident-calendar-workspace">
          <header className="page-heading resident-calendar-heading">
            <div className="heading-copy">
              <p className="eyebrow">Kalender</p>
              <h1>Kalender</h1>
              <p>{t.prefix}termine und geplante Aufgaben im Wohnbereich an einem Ort.</p>
            </div>
            <button className="primary-button" type="button" onClick={() => create()}>
              <Plus className="button-icon" /> Termin erstellen
            </button>
          </header>
          <CalendarSummary r={r} />
          <div className="resident-calendar-layout">
            <CalendarSidebar r={r} />
            <CalendarBoard r={r} />
          </div>
          {editor && (
            <ResidentAppointmentEditor
              key={editor.appointment?.id ?? `new-${editor.draft?.date}-${editor.draft?.startTime}`}
              appointment={editor.appointment}
              initialDraft={editor.draft}
              residents={residents}
              careUnits={careUnits}
              onClose={() => setEditor(null)}
              onSaved={saved}
            />
          )}
        </main>
      )}
    </ModulePageShell>
  );
}
