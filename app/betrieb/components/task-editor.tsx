"use client";

import { useTerms } from "@/app/components/care-context";
import { useState, type FormEvent } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { requestJson, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_RECURRENCE,
  type Task,
  type TaskPriority,
  type TaskRecurrence,
  type TasksPayload,
} from "@/lib/tasks-shared";
import { ScheduleDatePicker, ScheduleSelect, formatScheduleDate, notifyOperationsChanged } from "./operations-ui";
import { timeInZurich } from "@/app/components/workspace-ui";

// Create or edit a task. Options (people, care units) are loaded when not passed in.
export function TaskEditor({
  task,
  options,
  onClose,
  onSaved,
}: {
  task?: Task | null;
  options?: Pick<TasksPayload, "people" | "careUnits" | "currentUserId">;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const noContext = `Ohne ${t.prefix}bezug`;
  const residentsData = useApiData<{ residents: ResidentRow[] }>("/api/residents");
  const optionsData = useApiData<TasksPayload>(options ? null : "/api/tasks?scope=mine");
  const people = options?.people ?? optionsData.data?.people ?? [];
  const careUnits = options?.careUnits ?? optionsData.data?.careUnits ?? [];
  const currentUserId = options?.currentUserId ?? optionsData.data?.currentUserId ?? "";
  const residents = residentsData.data?.residents ?? [];
  const residentLabel = (r: ResidentRow) => `${r.first_name} ${r.last_name}${r.room ? ` · ${r.room}` : ""}`;
  const unitLabel = (u: { name: string }) => `${u.name} · allgemein`;

  const due = task?.dueAt ? zurichParts(task.dueAt) : null;
  const [title, setTitle] = useState(task?.title ?? "");
  const [category, setCategory] = useState(task?.category ?? "Pflege");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "normal");
  const [residentId, setResidentId] = useState(task?.residentId ?? "");
  const [careUnitId, setCareUnitId] = useState(task?.residentId ? "" : (task?.careUnitId ?? ""));
  const [dueDate, setDueDate] = useState(due?.date ?? todayInZurich());
  const [dueTime, setDueTime] = useState(due?.time ?? nextFullHour());
  const [assignedTo, setAssignedTo] = useState<string | null | undefined>(task ? task.assignedTo : undefined);
  const [recurrence, setRecurrence] = useState<TaskRecurrence>(task?.recurrence ?? "none");
  const [description, setDescription] = useState(task?.description ?? "");
  const [teamVisible, setTeamVisible] = useState(task?.teamVisible ?? true);
  const [remind, setRemind] = useState(task?.remind ?? true);
  const [documentOnCompletion, setDocumentOnCompletion] = useState(task?.documentOnCompletion ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const owner = assignedTo === undefined ? currentUserId : assignedTo;
  const ownerName = owner ? (people.find((p) => p.id === owner)?.name ?? "…") : UNASSIGNED;
  const resident = residents.find((r) => r.id === residentId);
  const unit = careUnits.find((u) => u.id === careUnitId);
  const contextValue = resident ? residentLabel(resident) : unit ? unitLabel(unit) : noContext;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = {
        title,
        category,
        priority,
        residentId: residentId || null,
        careUnitId: residentId ? null : careUnitId || null,
        assignedTo: owner || null,
        dueAt: zurichTimeToIso(dueDate, dueTime),
        recurrence,
        description,
        teamVisible,
        remind,
        documentOnCompletion: documentOnCompletion && Boolean(residentId),
      };
      if (task) await requestJson(`/api/tasks/${task.id}`, { method: "PATCH", body });
      else await requestJson("/api/tasks", { method: "POST", body });
      notifyOperationsChanged();
      onSaved(task ? "Aufgabe gespeichert" : `${title} wurde erstellt`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && !saving && onClose()}
    >
      <section
        className="area-editor-panel task-editor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">Aufgaben</p>
            <h2 id="task-editor-title">{task ? "Aufgabe bearbeiten" : "Aufgabe erstellen"}</h2>
            <p>Plane eine klare Intervention und weise sie direkt einer verantwortlichen Person zu.</p>
          </div>
          <button className="area-editor-close" type="button" onClick={onClose} aria-label="Aufgabeneditor schliessen">
            ×
          </button>
        </header>
        <form className="area-editor-form" onSubmit={submit}>
          <div className="area-editor-intro">
            <span className="area-editor-icon">
              <ModuleIcon name="tasks" />
            </span>
            <div>
              <strong>{task ? "Bestehende Aufgabe" : "Neue Teamaufgabe"}</strong>
              <p>
                {teamVisible
                  ? "Die Aufgabe erscheint im persönlichen und im gemeinsamen Arbeitsbereich."
                  : "Private Aufgabe – nur für dich sichtbar."}
              </p>
            </div>
            <span className="duty-assignment-status">
              <i />
              {task ? "Bearbeitung" : "Entwurf"}
            </span>
          </div>
          <div className="area-editor-grid">
            <label className="area-editor-wide">
              Aufgabentitel
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="z. B. Trinkmenge dokumentieren"
                maxLength={240}
                required
                autoFocus
              />
            </label>
            <label>
              Kategorie
              <ScheduleSelect
                label="Kategorie"
                value={category}
                options={[...TASK_CATEGORIES]}
                onChange={setCategory}
              />
            </label>
            <label>
              Priorität
              <ScheduleSelect
                label="Priorität"
                value={TASK_PRIORITIES[priority].label}
                options={PRIORITY_ORDER.map((key) => TASK_PRIORITIES[key].label)}
                onChange={(label) =>
                  setPriority(PRIORITY_ORDER.find((key) => TASK_PRIORITIES[key].label === label) ?? "normal")
                }
              />
            </label>
            <label className="area-editor-wide">
              {t.one} oder Kontext
              <ScheduleSelect
                label={`${t.one} oder Kontext`}
                value={contextValue}
                options={[noContext, ...residents.map(residentLabel), ...careUnits.map(unitLabel)]}
                onChange={(value) => {
                  const r = residents.find((item) => residentLabel(item) === value);
                  const u = careUnits.find((item) => unitLabel(item) === value);
                  setResidentId(r?.id ?? "");
                  setCareUnitId(u?.id ?? "");
                  if (!r) setDocumentOnCompletion(false);
                }}
              />
            </label>
            <label>
              Fällig am
              <ScheduleDatePicker label="Fällig am" value={dueDate} onChange={setDueDate} />
            </label>
            <label>
              Fällig um
              <input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} required />
            </label>
            <label>
              Verantwortlich
              <ScheduleSelect
                label="Verantwortlich"
                value={ownerName}
                options={[...people.map((person) => person.name), ...(teamVisible ? [UNASSIGNED] : [])]}
                onChange={(name) => setAssignedTo(people.find((person) => person.name === name)?.id ?? null)}
              />
            </label>
            <label>
              Wiederholung
              <ScheduleSelect
                label="Wiederholung"
                value={TASK_RECURRENCE[recurrence]}
                options={Object.values(TASK_RECURRENCE)}
                onChange={(label) =>
                  setRecurrence(
                    (Object.keys(TASK_RECURRENCE) as TaskRecurrence[]).find((key) => TASK_RECURRENCE[key] === label) ??
                      "none",
                  )
                }
              />
            </label>
            <label className="area-editor-wide">
              Beschreibung oder Intervention
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Beschreibe den nächsten konkreten Schritt …"
                maxLength={5000}
                rows={5}
              />
            </label>
            <fieldset className="area-editor-wide duty-assignment-options">
              <legend>Aufgabenoptionen</legend>
              <div className="area-service-options">
                <label className={teamVisible ? "selected" : ""}>
                  <input
                    type="checkbox"
                    checked={teamVisible}
                    onChange={(event) => {
                      setTeamVisible(event.target.checked);
                      if (!event.target.checked) setAssignedTo(currentUserId);
                    }}
                  />
                  <span>Im Team sichtbar</span>
                </label>
                <label className={remind ? "selected" : ""}>
                  <input type="checkbox" checked={remind} onChange={(event) => setRemind(event.target.checked)} />
                  <span>Erinnerung zum Fälligkeitstermin</span>
                </label>
                <label
                  className={documentOnCompletion ? "selected" : ""}
                  title={residentId ? undefined : `Nur mit ${t.prefix}bezug möglich`}
                >
                  <input
                    type="checkbox"
                    checked={documentOnCompletion}
                    disabled={!residentId}
                    onChange={(event) => setDocumentOnCompletion(event.target.checked)}
                  />
                  <span>Nach Erledigung dokumentieren</span>
                </label>
              </div>
            </fieldset>
          </div>
          <div className="duty-assignment-summary">
            <span>
              <strong>{title || "Neue Aufgabe"}</strong>
              <small>
                {contextValue} · {category}
              </small>
            </span>
            <span>
              <strong>
                {formatScheduleDate(dueDate)} · {dueTime}
              </strong>
              <small>
                {ownerName} · {TASK_PRIORITIES[priority].label}
                {recurrence !== "none" ? ` · ${TASK_RECURRENCE[recurrence]}` : ""}
              </small>
            </span>
          </div>
          {error && (
            <p className="appointment-editor-error" role="alert">
              {error}
            </p>
          )}
          <footer className="area-editor-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit" disabled={saving || title.trim().length < 3}>
              <ModuleIcon name="check" /> {saving ? "Speichern…" : task ? "Änderungen speichern" : "Aufgabe erstellen"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export type ResidentRow = { id: string; first_name: string; last_name: string; room: string; care_unit: string };

export const UNASSIGNED = "Nicht zugewiesen · Team";

export const PRIORITY_ORDER: TaskPriority[] = ["normal", "high", "critical", "low"];

export const zurichParts = (value: string) => {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(date),
    time: timeInZurich(date),
  };
};

export function nextFullHour() {
  const [hours] = timeInZurich().split(":").map(Number);
  return `${String(Math.min(hours + 1, 23)).padStart(2, "0")}:00`;
}
