"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { EditorDialog, ReasonDialog, formatDateTime, requestJson, type ShowToast } from "@/app/components/workspace-ui";
import { TASK_PRIORITIES, TASK_RECURRENCE, TASK_STATUS, isActiveTask, type Task } from "@/lib/tasks-shared";
import { notifyOperationsChanged } from "./operations-ui";
import { statusLabel, statusTone } from "./task-utils";

export function TaskDetailDialog({
  task,
  canWrite,
  onClose,
  onEdit,
  onToggle,
  onChanged,
  showToast,
}: {
  task: Task;
  canWrite: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onChanged: (message: string) => void;
  showToast: ShowToast;
}) {
  const t = useTerms();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const setStatus = async (status: "open" | "in_progress", message: string) => {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/tasks/${task.id}/status`, { method: "POST", body: { status } });
      notifyOperationsChanged();
      onChanged(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  const active = isActiveTask(task.status);
  const finished = !active && task.status !== "cancelled";
  if (escalating)
    return (
      <ReasonDialog
        eyebrow="Aufgaben"
        title="Aufgabe eskalieren"
        description={`„${task.title}“ bleibt offen. Die Leitung wird sofort benachrichtigt.`}
        label="Grund"
        placeholder={`z. B. ${t.one} verweigert wiederholt, Material fehlt, ärztliche Rücksprache nötig`}
        submitLabel="Eskalieren"
        danger
        onClose={() => setEscalating(false)}
        onConfirm={async (reason) => {
          await requestJson(`/api/tasks/${task.id}/status`, { method: "POST", body: { status: "escalated", reason } });
          notifyOperationsChanged();
          onChanged("Aufgabe eskaliert – die Leitung ist informiert");
        }}
      />
    );
  if (cancelling)
    return (
      <ReasonDialog
        eyebrow="Aufgaben"
        title="Aufgabe abbrechen"
        description={`„${task.title}“ wird nicht mehr durchgeführt. Die Aufgabe bleibt mit Begründung nachvollziehbar.`}
        label="Grund"
        placeholder={`z. B. ärztlich abgesetzt, ${t.one} ausgetreten, doppelt erfasst`}
        submitLabel="Aufgabe abbrechen"
        danger
        onClose={() => setCancelling(false)}
        onConfirm={async (reason) => {
          await requestJson(`/api/tasks/${task.id}/status`, { method: "POST", body: { status: "cancelled", reason } });
          notifyOperationsChanged();
          showToast("Aufgabe abgebrochen");
          onChanged("Aufgabe abgebrochen");
        }}
      />
    );
  return (
    <EditorDialog
      id="task-detail"
      eyebrow={`Aufgaben · ${task.category}`}
      title={task.title}
      description={task.description || undefined}
      onClose={onClose}
      onSubmit={() => {
        if (!canWrite || task.status === "cancelled") onClose();
        else if (finished) void setStatus("open", "Aufgabe wieder geöffnet");
        else onToggle();
      }}
      saving={saving}
      error={error}
      submitLabel={
        !canWrite || task.status === "cancelled" ? "Schliessen" : finished ? "Wieder öffnen" : "Abschliessen"
      }
      extraActions={
        canWrite && active ? (
          <>
            {task.canEdit && (
              <button className="quiet-button" type="button" onClick={() => setCancelling(true)} disabled={saving}>
                Aufgabe abbrechen
              </button>
            )}
            {task.canEdit && (
              <button className="quiet-button" type="button" onClick={onEdit} disabled={saving}>
                Bearbeiten
              </button>
            )}
            {task.status !== "escalated" && (
              <button className="quiet-button" type="button" onClick={() => setEscalating(true)} disabled={saving}>
                Eskalieren
              </button>
            )}
            <button
              className="quiet-button"
              type="button"
              disabled={saving}
              onClick={() =>
                void (task.status === "in_progress"
                  ? setStatus("open", "Aufgabe wieder offen")
                  : setStatus("in_progress", "Aufgabe in Bearbeitung"))
              }
            >
              {task.status === "in_progress" ? "Zurück auf offen" : "Beginnen"}
            </button>
          </>
        ) : null
      }
    >
      <dl className="area-editor-wide task-detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`status-badge ${statusTone(task)}`}>{statusLabel(task)}</span>
          </dd>
        </div>
        <div>
          <dt>Priorität</dt>
          <dd>{TASK_PRIORITIES[task.priority].label}</dd>
        </div>
        <div>
          <dt>Fällig</dt>
          <dd>{task.dueAt ? formatDateTime(task.dueAt) : "Ohne Termin"}</dd>
        </div>
        <div>
          <dt>Wiederholung</dt>
          <dd>{TASK_RECURRENCE[task.recurrence]}</dd>
        </div>
        <div>
          <dt>Bezug</dt>
          <dd>
            {task.residentName
              ? `${task.residentName}${task.room ? ` · ${task.room}` : ""}`
              : (task.careUnit ?? `Ohne ${t.prefix}bezug`)}
          </dd>
        </div>
        <div>
          <dt>Verantwortlich</dt>
          <dd>{task.assigneeName ?? "Nicht zugewiesen"}</dd>
        </div>
        <div>
          <dt>Erstellt</dt>
          <dd>
            {formatDateTime(task.createdAt)} · {task.creatorName ?? "unbekannt"}
          </dd>
        </div>
        <div>
          <dt>Optionen</dt>
          <dd>
            {[
              task.teamVisible ? "Im Team sichtbar" : "Privat",
              task.remind ? "Erinnerung" : null,
              task.documentOnCompletion ? "Dokumentationspflicht" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </dd>
        </div>
        {task.escalatedAt && (
          <div className="wide">
            <dt>Eskaliert</dt>
            <dd>
              {formatDateTime(task.escalatedAt)} · {task.escalatedByName ?? "unbekannt"}
              {task.escalationReason ? ` – ${task.escalationReason}` : ""}
            </dd>
          </div>
        )}
        {task.completedAt && (
          <div className="wide">
            <dt>{finished ? TASK_STATUS[task.status] : "Erledigt"}</dt>
            <dd>
              {formatDateTime(task.completedAt)} · {task.completedByName ?? "unbekannt"}
              {task.completionNote ? ` – ${task.completionNote}` : ""}
            </dd>
          </div>
        )}
        {task.cancelReason && (
          <div className="wide">
            <dt>Abgebrochen</dt>
            <dd>{task.cancelReason}</dd>
          </div>
        )}
      </dl>
    </EditorDialog>
  );
}
