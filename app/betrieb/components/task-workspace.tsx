"use client";

import { Suspense, useEffect, useState } from "react";
import { useApiData } from "@/app/components/workspace-ui";
import { type Task, type TasksPayload } from "@/lib/tasks-shared";
import { OPERATIONS_CHANGED, OperationsFrame } from "./operations-ui";
import { TaskEditor } from "./task-editor";
import { TaskView } from "./task-view";

export default function TaskWorkspace({ team }: { team: boolean }) {
  const data = useApiData<TasksPayload>(`/api/tasks?scope=${team ? "team" : "mine"}`);
  const { reload } = data;
  const [editor, setEditor] = useState<{ task: Task | null } | null>(null);
  useEffect(() => {
    window.addEventListener(OPERATIONS_CHANGED, reload);
    return () => window.removeEventListener(OPERATIONS_CHANGED, reload);
  }, [reload]);
  return (
    <OperationsFrame
      module="tasks"
      child={team ? "Teamaufgaben" : "Meine Aufgaben"}
      view={team ? "teamTasks" : "tasks"}
      eyebrow="Aufgaben"
      title={team ? "Teamaufgaben" : "Meine Aufgaben"}
      description={
        team
          ? "Aufgaben im Team verteilen, verfolgen und gemeinsam abschliessen."
          : "Alle offenen Aufgaben und Interventionen für deinen Dienst."
      }
      action={
        data.data?.canWrite
          ? { label: team ? "Teamaufgabe erstellen" : "Aufgabe erstellen", onClick: () => setEditor({ task: null }) }
          : null
      }
    >
      {(showToast) => (
        <>
          {/* TaskView reads ?task= (useSearchParams), which needs a Suspense boundary on a static page. */}
          <Suspense fallback={null}>
            <TaskView
              team={team}
              showToast={showToast}
              data={data}
              reload={reload}
              onEdit={(task) => setEditor({ task })}
            />
          </Suspense>
          {editor && (
            <TaskEditor
              task={editor.task}
              options={data.data}
              onClose={() => setEditor(null)}
              onSaved={(message) => {
                setEditor(null);
                showToast(message);
                reload();
              }}
            />
          )}
        </>
      )}
    </OperationsFrame>
  );
}
