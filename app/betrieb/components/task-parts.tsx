"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { EditorDialog, requestJson, type ShowToast } from "@/app/components/workspace-ui";
import { notifyOperationsChanged } from "./operations-ui";
import { sendOrQueue } from "@/app/components/offline-queue";
import { TASK_OUTCOMES, type TaskOutcome } from "@/lib/tasks-shared";

type OutcomeTask = { id: string; title: string; residentName: string | null; documentOnCompletion: boolean };

const OUTCOME_HINTS: Record<TaskOutcome, { note: string; placeholder: string; done: string }> = {
  completed: {
    note: "Notiz (optional)",
    placeholder: "Was wurde durchgeführt? Wirkung, Reaktion, Auffälligkeiten.",
    done: "Aufgabe erledigt",
  },
  partial: {
    note: "Was wurde erledigt, was bleibt offen?",
    placeholder: "z. B. Grundpflege durchgeführt, Haarwäsche abgelehnt",
    done: "Aufgabe als teilweise erledigt abgeschlossen",
  },
  skipped: {
    note: "Grund",
    placeholder: "z. B. Bewohnerin schläft, Termin beim Arzt, abgelehnt",
    done: "Aufgabe als nicht erledigt abgeschlossen",
  },
};

// Abschluss mit Ergebnis: ✓ erledigt, △ teilweise, ✕ nicht erledigt. Abweichungen brauchen eine Begründung und
// werden bei Bewohneraufgaben in der Pflegedokumentation festgehalten.
export function TaskCompleteDialog({
  task,
  onClose,
  onDone,
}: {
  task: OutcomeTask;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTerms();
  const [outcome, setOutcome] = useState<TaskOutcome>("completed");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const hint = OUTCOME_HINTS[outcome];
  const required = outcome !== "completed" || task.documentOnCompletion;
  const documented = Boolean(task.residentName) && (outcome !== "completed" || task.documentOnCompletion);
  return (
    <EditorDialog
      id="task-complete"
      eyebrow="Aufgaben · Abschluss"
      title={task.title}
      description={
        documented
          ? `Deine Notiz wird als Pflegedokumentation${task.residentName ? ` bei ${task.residentName}` : ""} gespeichert.`
          : required
            ? "Bitte kurz festhalten, was durchgeführt wurde."
            : "Optional: kurz festhalten, was erledigt wurde."
      }
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          const result = await sendOrQueue(
            `/api/tasks/${task.id}/status`,
            { status: outcome, note, completedAt: new Date().toISOString() },
            `Aufgabe ${TASK_OUTCOMES[outcome].label.toLowerCase()} · ${task.title}`,
            { field: "note", label: outcome === "skipped" ? "Grund" : "Notiz" },
          );
          notifyOperationsChanged();
          onDone(
            result.queued
              ? "Abschluss offline vorgemerkt – wird gesendet, sobald die Verbindung zurück ist"
              : documented
                ? `${hint.done} und dokumentiert`
                : hint.done,
          );
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Abschliessen"
    >
      <fieldset className="area-editor-wide">
        <legend>Ergebnis</legend>
        <div className="operations-filter-buttons task-outcomes">
          {(Object.keys(TASK_OUTCOMES) as TaskOutcome[]).map((key) => (
            <button
              className={outcome === key ? "active" : ""}
              type="button"
              key={key}
              aria-pressed={outcome === key}
              onClick={() => setOutcome(key)}
            >
              <span aria-hidden="true">{TASK_OUTCOMES[key].symbol}</span> {TASK_OUTCOMES[key].label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="area-editor-wide">
        <span>{task.documentOnCompletion && outcome === "completed" ? "Dokumentation" : hint.note}</span>
        <textarea
          autoFocus
          rows={5}
          maxLength={10000}
          required={required}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={hint.placeholder.replace("Bewohnerin", t.oneFemale)}
        />
      </label>
    </EditorDialog>
  );
}

// Toggles a task between done and open; tasks that need documentation open the completion dialog instead.
export function useTaskToggle(showToast: ShowToast, onChanged: () => void) {
  const [completing, setCompleting] = useState<OutcomeTask | null>(null);
  const toggle = async (task: {
    id: string;
    title: string;
    done: boolean;
    residentName: string | null;
    documentOnCompletion: boolean;
  }) => {
    if (!task.done && task.documentOnCompletion) {
      setCompleting(task);
      return;
    }
    try {
      // Erledigen geht auch offline (wird nachgereicht); wieder öffnen nur mit Verbindung.
      const result = task.done
        ? (await requestJson(`/api/tasks/${task.id}/status`, { method: "POST", body: { status: "open" } }),
          { queued: false })
        : await sendOrQueue(
            `/api/tasks/${task.id}/status`,
            { status: "completed", completedAt: new Date().toISOString() },
            `Aufgabe erledigt · ${task.title}`,
          );
      notifyOperationsChanged();
      showToast(
        task.done
          ? "Aufgabe wieder geöffnet"
          : result.queued
            ? "Aufgabe offline als erledigt vorgemerkt – wird gesendet, sobald die Verbindung zurück ist"
            : "Aufgabe erledigt",
      );
      onChanged();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    }
  };
  const dialog = completing ? (
    <TaskCompleteDialog
      task={completing}
      onClose={() => setCompleting(null)}
      onDone={(message) => {
        setCompleting(null);
        showToast(message);
        onChanged();
      }}
    />
  ) : null;
  // Abschluss mit Wahl des Ergebnisses (✓ △ ✕).
  const finish = (task: OutcomeTask) => setCompleting(task);
  return { toggle, finish, dialog };
}
