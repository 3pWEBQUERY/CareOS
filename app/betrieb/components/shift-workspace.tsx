"use client";

import { useEffect, useState } from "react";
import { useApiData } from "@/app/components/workspace-ui";
import { type ShiftHistory, type ShiftOverview } from "@/lib/shift-shared";
import { OPERATIONS_CHANGED, OperationsFrame } from "./operations-ui";
import { TaskEditor } from "./task-editor";
import { ShiftPageView } from "./shift-utils";
import { ShiftStartEditor } from "./shift-start-editor";
import { ShiftEndDialog } from "./shift-end-dialog";
import { ShiftView } from "./shift-view";
import { exportHistory, ShiftHistoryView } from "./shift-history-view";

export default function ShiftWorkspace({ view }: { view: ShiftPageView }) {
  const [unitParam, setUnitParam] = useState("");
  const [fullDay, setFullDay] = useState(false);
  const [days, setDays] = useState(90);
  const overview = useApiData<ShiftOverview>(
    view === "shift"
      ? `/api/shift?range=${fullDay ? "day" : "shift"}${unitParam ? `&careUnitId=${unitParam}` : ""}`
      : null,
  );
  const history = useApiData<ShiftHistory>(view === "shiftHistory" ? `/api/shift/history?days=${days}` : null);
  const reload = view === "shift" ? overview.reload : history.reload;
  const [dialog, setDialog] = useState<"start" | "end" | "task" | null>(null);
  useEffect(() => {
    window.addEventListener(OPERATIONS_CHANGED, reload);
    return () => window.removeEventListener(OPERATIONS_CHANGED, reload);
  }, [reload]);
  const checkedIn = Boolean(overview.data?.current?.checkedInAt);
  return (
    <OperationsFrame
      module="shift"
      child={view === "shift" ? "Mein Dienst" : "Schichtverlauf"}
      view={view}
      eyebrow="Mein Dienst"
      title={view === "shift" ? "Mein Dienst" : "Schichtverlauf"}
      description={
        view === "shift"
          ? "Dein persönlicher Schichtarbeitsplatz für heute."
          : "Abgeschlossene Dienste, Übergaben und dokumentierte Aktivitäten."
      }
      action={
        view === "shift"
          ? overview.data
            ? {
                label: checkedIn ? "Dienst beenden" : "Dienst starten",
                icon: checkedIn ? "check" : "plus",
                onClick: () => setDialog(checkedIn ? "end" : "start"),
              }
            : null
          : {
              label: "Bericht exportieren",
              icon: "docs",
              onClick: (showToast) => {
                const entries = history.data?.entries ?? [];
                if (entries.length) exportHistory(entries);
                showToast(entries.length ? "Schichtbericht als CSV exportiert" : "Keine Dienste zum Exportieren");
              },
            }
      }
    >
      {(showToast) => (
        <>
          {view === "shift" ? (
            <ShiftView
              showToast={showToast}
              overview={overview}
              reload={reload}
              unitParam={unitParam}
              setUnitParam={setUnitParam}
              fullDay={fullDay}
              setFullDay={setFullDay}
              onCreateTask={() => setDialog("task")}
            />
          ) : (
            <ShiftHistoryView history={history} reload={reload} days={days} setDays={setDays} />
          )}
          {dialog === "start" && overview.data && (
            <ShiftStartEditor
              overview={overview.data}
              onClose={() => setDialog(null)}
              onStarted={(message) => {
                setDialog(null);
                showToast(message);
              }}
            />
          )}
          {dialog === "end" && overview.data && (
            <ShiftEndDialog
              overview={overview.data}
              onClose={() => setDialog(null)}
              onEnded={(message) => {
                setDialog(null);
                showToast(message);
              }}
            />
          )}
          {dialog === "task" && (
            <TaskEditor
              onClose={() => setDialog(null)}
              onSaved={(message) => {
                setDialog(null);
                showToast(message);
              }}
            />
          )}
        </>
      )}
    </OperationsFrame>
  );
}
