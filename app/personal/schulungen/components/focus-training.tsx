"use client";

import { ModuleIcon } from "@/app/components/module-icon";
import { formatDate } from "@/app/components/workspace-ui";
import { type LearningPayload, type Training } from "@/lib/learning-shared";
import { CATEGORY_ICONS, sessionLabel, trainingState, trainingMeta, Dialog } from "./learning-utils";

export function FocusTraining({
  training,
  data,
  setDialog,
  run,
}: {
  training: Training;
  data: LearningPayload;
  setDialog: (dialog: Dialog) => void;
  run: (url: string, body: unknown, message: string) => Promise<void>;
}) {
  const e = training.enrollment;
  const activeEnrollment = e && e.status !== "completed";
  const booked = training.sessions.find((s) => s.mine);
  const state = trainingState(training);
  return (
    <>
      <div className="learning-focus">
        <span
          className={`governance-focus-icon ${state.tone === "critical" ? "critical" : state.tone === "stable" ? "stable" : ""}`}
        >
          <ModuleIcon name={CATEGORY_ICONS[training.category] ?? "learn"} />
        </span>
        <div>
          <p className="eyebrow">
            {activeEnrollment ? "Als Nächstes" : training.enrollment?.completedAt ? "Abgeschlossen" : "Im Katalog"} ·{" "}
            {state.label}
          </p>
          <h3>{training.title}</h3>
          <p>
            {booked
              ? `Dein Termin: ${sessionLabel(booked)}`
              : e?.dueOn && activeEnrollment
                ? `Frist ${formatDate(e.dueOn)}${e.assignedByName ? ` · zugewiesen von ${e.assignedByName}` : ""}`
                : e?.completedAt
                  ? `${e.quizPassedAt && e.quizScore !== null ? `Quiz bestanden (${e.quizScore} %) · ` : ""}Abgeschlossen am ${formatDate(e.completedAt)}${e.validUntil ? ` · gültig bis ${formatDate(e.validUntil)}` : ""}`
                  : (training.description ?? trainingMeta(training, Date.parse(data.today)))}
          </p>
        </div>
        <div className="learning-focus-actions">
          {training.linkUrl && activeEnrollment && (
            <a className="quiet-button" href={training.linkUrl} target="_blank" rel="noreferrer">
              Kurs öffnen
            </a>
          )}
          {activeEnrollment && training.format === "elearning" && (
            <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "progress", training })}>
              Fortschritt
            </button>
          )}
          {activeEnrollment && !e?.assignedByName && (
            <button
              className="quiet-button"
              type="button"
              onClick={() => void run(`/api/learning/enrollments/${e!.id}`, { action: "withdraw" }, "Abgemeldet")}
            >
              Abmelden
            </button>
          )}
          {activeEnrollment && training.format !== "elearning" && training.sessions.length > 0 && (
            <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "enroll", training })}>
              {booked ? "Termin ändern" : "Termin wählen"}
            </button>
          )}
          {activeEnrollment && training.quiz && (
            <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "quiz", training })}>
              {e?.quizScore !== null ? "Quiz wiederholen" : "Quiz starten"}
            </button>
          )}
          {activeEnrollment ? (
            <button
              className={training.quiz ? "quiet-button" : "secondary-button"}
              type="button"
              onClick={() => setDialog({ kind: "evidence", trainingId: training.id, userId: null })}
            >
              Abschluss melden
            </button>
          ) : (
            <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "enroll", training })}>
              {e?.completedAt ? "Auffrischen" : "Anmelden"}
            </button>
          )}
        </div>
      </div>
      {data.canManage && (
        <div className="learning-manage">
          <span>
            Leitung · {training.enrolledCount} {training.enrolledCount === 1 ? "Anmeldung" : "Anmeldungen"}
          </span>
          <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "assign", training })}>
            Zuweisen
          </button>
          <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "session", training })}>
            Termin hinzufügen
          </button>
          <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "training", training })}>
            Bearbeiten
          </button>
          <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "archive", training })}>
            Archivieren
          </button>
          {training.sessions
            .filter((s) => Date.parse(s.startsAt) > Date.parse(data.today))
            .map((s) => (
              <span className="learning-manage-session" key={s.id}>
                {sessionLabel(s)}
                <button type="button" onClick={() => void run(`/api/learning/sessions/${s.id}`, {}, "Termin abgesagt")}>
                  Absagen
                </button>
              </span>
            ))}
        </div>
      )}
    </>
  );
}
