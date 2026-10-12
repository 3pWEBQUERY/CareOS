"use client";

import { EditorDialog, LoadError, type ShowToast } from "@/app/components/workspace-ui";
import { type LearningPayload } from "@/lib/learning-shared";
import { Dialog } from "./learning-utils";
import { EvidenceDialog } from "./evidence-dialog";
import { EnrollDialog, ProgressDialog } from "./enrollment-dialogs";
import { QuizDialog } from "./quiz-dialog";
import { TrainingEditor } from "./training-editor";
import { SessionDialog, AssignDialog } from "./training-admin-dialogs";
import { useLearningView } from "./use-learning-view";
import { LearningSummary } from "./learning-summary";
import { LearningProgressCard } from "./learning-progress-card";
import { LearningCatalog } from "./learning-catalog";
import { LearningCalendar } from "./learning-calendar";

export function LearningView(props: {
  compliance: boolean;
  showToast: ShowToast;
  dialog: Dialog | null;
  setDialog: (dialog: Dialog | null) => void;
  onData: (data: LearningPayload | undefined) => void;
  searchRef: React.RefObject<HTMLDivElement | null>;
}) {
  const r = useLearningView(props);
  const { compliance, dialog, setDialog, learning, reload, data, done, run } = r;
  return (
    <>
      <LearningSummary r={r} />
      {learning.error && <LoadError message={learning.error} onRetry={reload} />}
      <div className={`learning-layout ${compliance ? "learning-compliance-layout" : "learning-personal-layout"}`}>
        <LearningProgressCard r={r} />
        <LearningCatalog r={r} />
        <LearningCalendar r={r} />
      </div>
      {data && dialog?.kind === "evidence" && (
        <EvidenceDialog
          data={data}
          trainingId={dialog.trainingId}
          userId={dialog.userId}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === "enroll" && (
        <EnrollDialog training={dialog.training} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "progress" && (
        <ProgressDialog training={dialog.training} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "quiz" && dialog.training.quiz && (
        <QuizDialog training={dialog.training} onClose={() => setDialog(null)} onSaved={done} onAttempt={reload} />
      )}
      {data && dialog?.kind === "training" && (
        <TrainingEditor data={data} training={dialog.training} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {data && dialog?.kind === "session" && (
        <SessionDialog data={data} training={dialog.training} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {data && dialog?.kind === "assign" && (
        <AssignDialog data={data} training={dialog.training} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "archive" && (
        <EditorDialog
          id="training-archive"
          eyebrow="Schulungen · Kurskatalog"
          title="Schulung archivieren"
          description={`„${dialog.training.title}“ wird aus dem Katalog und den Pflichtnachweisen entfernt. Bestehende Nachweise bleiben im Protokoll erhalten.`}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            await run(`/api/learning/trainings/${dialog.training.id}`, { action: "archive" }, "Schulung archiviert");
            setDialog(null);
          }}
          saving={false}
          error=""
          submitLabel="Archivieren"
          danger
        >
          {null}
        </EditorDialog>
      )}
    </>
  );
}
