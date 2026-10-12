"use client";

import { useEffect, useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";
import { TASK_CATEGORIES, TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks-shared";

type Step = {
  key: number;
  title: string;
  description: string;
  category: string;
  priority: TaskPriority;
  hours: string;
  documentOnCompletion: boolean;
};
type StoredStep = Omit<Step, "key" | "hours" | "description"> & {
  description: string | null;
  dueOffsetMinutes: number;
};

let nextKey = 0;
const blank = (): Step => ({
  key: ++nextKey,
  title: "",
  description: "",
  category: "",
  priority: "normal",
  hours: "",
  documentOnCompletion: false,
});
const priorities = Object.entries(TASK_PRIORITIES) as Array<[TaskPriority, { label: string }]>;
const NOT_CHOSEN = "Bitte wählen";

// Ablaufketten je Ereignisart: Folgeschritte mit Fälligkeit nach dem Ereignis. Die Einrichtung legt sie selbst fest.
export function WorkflowEditor({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [type, setType] = useState<string>("");
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<Record<string, StoredStep[]> | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    requestJson<{ workflows: Record<string, StoredStep[]>; eventTypes: string[] }>("/api/quality/workflows").then(
      (result) => {
        if (!live) return;
        setEventTypes(result.eventTypes);
        setType((current) => current || result.eventTypes[0] || "");
        setWorkflows(result.workflows);
      },
      (cause: Error) => live && setError(cause.message),
    );
    return () => {
      live = false;
    };
  }, []);

  const load = (nextType: string, source = workflows) => {
    setType(nextType);
    setSteps(
      (source?.[nextType] ?? []).map((step) => ({
        ...step,
        key: ++nextKey,
        description: step.description ?? "",
        hours: String(Math.round((step.dueOffsetMinutes / 60) * 100) / 100),
      })),
    );
  };
  const [loadedFor, setLoadedFor] = useState<object | null>(null);
  if (workflows && loadedFor !== workflows) {
    setLoadedFor(workflows);
    load(type, workflows);
  }
  const set = (index: number, patch: Partial<Step>) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));

  return (
    <EditorDialog
      id="quality-workflows"
      eyebrow="Qualität · Ablaufketten"
      title="Ablaufketten festlegen"
      description="Beim Melden eines Ereignisses entstehen aus den Schritten Aufgaben für das Team, fällig ab dem Zeitpunkt des Ereignisses. Ohne Schritte entsteht nichts."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await requestJson("/api/quality/workflows", {
            method: "PUT",
            body: {
              type,
              steps: steps.map((step) => ({
                title: step.title,
                description: step.description,
                category: step.category,
                priority: step.priority,
                dueOffsetMinutes:
                  step.hours.trim() === "" ? null : Math.round(Number(step.hours.replace(",", ".")) * 60),
                documentOnCompletion: step.documentOnCompletion,
              })),
            },
          });
          onSaved(`Ablaufkette „${type}“ gespeichert`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Ablaufkette speichern"
    >
      <label className="area-editor-wide">
        <span>Ereignisart</span>
        <CareSelect label="Ereignisart" value={type} options={eventTypes} onChange={(value) => load(value)} />
      </label>
      {!workflows && <p className="area-editor-wide list-hint">Ablaufketten werden geladen …</p>}
      {workflows && !steps.length && (
        <p className="area-editor-wide list-hint">Für „{type}“ ist keine Ablaufkette festgelegt.</p>
      )}
      {steps.map((step, index) => (
        <fieldset className="area-editor-wide quality-workflow-step" key={step.key}>
          <legend>Schritt {index + 1}</legend>
          <label className="area-editor-wide">
            <span>Titel</span>
            <input value={step.title} maxLength={240} onChange={(e) => set(index, { title: e.target.value })} />
          </label>
          <label>
            <span>Fällig nach (Stunden)</span>
            <input
              inputMode="decimal"
              value={step.hours}
              aria-label={`Schritt ${index + 1}: fällig nach Stunden`}
              onChange={(e) => set(index, { hours: e.target.value })}
            />
          </label>
          <label>
            <span>Kategorie</span>
            <CareSelect
              label={`Schritt ${index + 1}: Kategorie`}
              value={step.category || NOT_CHOSEN}
              options={[NOT_CHOSEN, ...TASK_CATEGORIES]}
              onChange={(value) => set(index, { category: value === NOT_CHOSEN ? "" : value })}
            />
          </label>
          <label>
            <span>Priorität</span>
            <CareSelect
              label={`Schritt ${index + 1}: Priorität`}
              value={TASK_PRIORITIES[step.priority].label}
              options={priorities.map(([, item]) => item.label)}
              onChange={(value) =>
                set(index, { priority: priorities.find(([, item]) => item.label === value)?.[0] ?? "normal" })
              }
            />
          </label>
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={step.documentOnCompletion}
              onChange={(e) => set(index, { documentOnCompletion: e.target.checked })}
            />
            Beim Abschluss dokumentieren
          </label>
          <label className="area-editor-wide">
            <span>Beschreibung (optional)</span>
            <textarea
              rows={2}
              maxLength={4000}
              value={step.description}
              onChange={(e) => set(index, { description: e.target.value })}
            />
          </label>
          <div className="area-editor-wide quality-workflow-step-actions">
            <button
              className="quiet-button"
              type="button"
              onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
            >
              Schritt entfernen
            </button>
          </div>
        </fieldset>
      ))}
      {workflows && (
        <div className="area-editor-wide">
          <button
            className="secondary-button"
            type="button"
            onClick={() => setSteps((current) => [...current, blank()])}
          >
            Schritt hinzufügen
          </button>
        </div>
      )}
    </EditorDialog>
  );
}
