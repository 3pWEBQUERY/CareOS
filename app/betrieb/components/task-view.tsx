"use client";

import { useTerms } from "@/app/components/care-context";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  LoadError,
  timeInZurich,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  TASK_PRIORITIES,
  TASK_RECURRENCE,
  isActiveTask,
  personInitials,
  type Task,
  type TasksPayload,
} from "@/lib/tasks-shared";
import { ScheduleSelect, Summary, type Tone } from "./operations-ui";
import { useTaskToggle } from "./task-parts";
import { zurichDay, shortDate, statusLabel, statusTone, isFinishedTask, ALL_PEOPLE, UNASSIGNED } from "./task-utils";
import { TaskDetailDialog } from "./task-detail-dialog";

export function TaskView({
  team,
  showToast,
  data,
  reload,
  onEdit,
}: {
  team: boolean;
  showToast: ShowToast;
  data: ReturnType<typeof useApiData<TasksPayload>>;
  reload: () => void;
  onEdit: (task: Task) => void;
}) {
  const t = useTerms();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const detailId = params.get("task");
  const [filter, setFilter] = useState("Alle");
  const [person, setPerson] = useState(ALL_PEOPLE);
  const [query, setQuery] = useState("");
  const payload = data.data;
  const tasks = useMemo(() => payload?.tasks ?? [], [payload]);
  const today = todayInZurich();
  const { toggle, finish, dialog } = useTaskToggle(showToast, reload);
  const detail = detailId ? tasks.find((task) => task.id === detailId) : undefined;
  const setDetail = (id: string | null) => router.replace(id ? `${pathname}?task=${id}` : pathname, { scroll: false });

  const visible = tasks.filter((task) => task.status !== "cancelled" || filter === "Abgebrochen");
  const filtered = visible.filter((task) => {
    const open = isActiveTask(task.status);
    if (filter === "Offen" && task.status !== "open") return false;
    if (filter === "In Bearbeitung" && task.status !== "in_progress") return false;
    if (filter === "Eskaliert" && task.status !== "escalated") return false;
    if (filter === "Erledigt" && !isFinishedTask(task)) return false;
    if (filter === "Abgebrochen" && task.status !== "cancelled") return false;
    if (filter === "Überfällig" && !(open && task.overdue)) return false;
    if (filter === "Heute fällig" && !(open && task.dueAt && zurichDay(task.dueAt) === today)) return false;
    if (person === UNASSIGNED && task.assignedTo) return false;
    if (person !== ALL_PEOPLE && person !== UNASSIGNED && task.assigneeName !== person) return false;
    const needle = query.trim().toLocaleLowerCase("de-CH");
    if (
      needle &&
      !`${task.title} ${task.description} ${task.residentName ?? ""} ${task.category}`
        .toLocaleLowerCase("de-CH")
        .includes(needle)
    )
      return false;
    return true;
  });
  const openTasks = visible.filter((task) => isActiveTask(task.status));
  const filters = team
    ? ["Alle", "Offen", "In Bearbeitung", "Eskaliert", "Überfällig", "Erledigt", "Abgebrochen"]
    : ["Alle", "Offen", "Heute fällig", "Überfällig", "Erledigt"];

  return (
    <>
      <Summary
        items={[
          {
            icon: "tasks",
            value: String(openTasks.length),
            label: team ? "offene Aufgaben im Team" : "offene Aufgaben für dich",
          },
          {
            icon: "alert",
            value: String(openTasks.filter((task) => task.priority === "high" || task.priority === "critical").length),
            label: "dringend",
            tone: "critical",
          },
          {
            icon: "calendar",
            value: String(openTasks.filter((task) => task.dueAt && zurichDay(task.dueAt) <= today).length),
            label: "heute fällig oder überfällig",
            tone: "attention",
          },
          {
            icon: "check",
            value: String(visible.filter(isFinishedTask).length),
            label: "erledigt (7 Tage)",
            tone: "info",
          },
        ]}
      />
      <section className="card operations-list-card">
        <div className="operations-toolbar task-toolbar">
          <div>
            <h2 className="card-title">{team ? "Aufgaben im Team" : "Deine Aufgaben"}</h2>
            <p className="card-subtitle">
              {filtered.length} {filtered.length === 1 ? "Aufgabe" : "Aufgaben"} sichtbar
            </p>
          </div>
          <div className="operations-filter-buttons">
            {filters.map((item) => (
              <button
                className={filter === item ? "active" : ""}
                type="button"
                key={item}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        {team && (
          <div className="task-subbar">
            <ScheduleSelect
              label="Person"
              value={person}
              options={[ALL_PEOPLE, UNASSIGNED, ...(payload?.people ?? []).map((p) => p.name)]}
              onChange={setPerson}
            />
            <label className="resident-search">
              <ModuleIcon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Titel, ${t.one} oder Kategorie`}
                aria-label="Aufgaben durchsuchen"
              />
            </label>
          </div>
        )}
        {data.error && <LoadError message={data.error} onRetry={reload} />}
        <div className="task-list">
          {filtered.map((task) => {
            const done = isFinishedTask(task);
            const inactive = done || task.status === "cancelled";
            const tone: Tone =
              task.priority === "critical" ? "critical" : task.priority === "high" ? "attention" : "info";
            return (
              <article
                className={`task-row ${inactive ? "complete" : ""} ${task.overdue ? "overdue" : ""}`}
                key={task.id}
              >
                <button
                  className="task-check"
                  type="button"
                  disabled={!payload?.canWrite || task.status === "cancelled"}
                  aria-label={`${task.title} ${done ? "wieder öffnen" : "erledigt markieren"}`}
                  onClick={() => void toggle({ ...task, done })}
                >
                  <ModuleIcon name={done ? "check" : task.status === "cancelled" ? "close" : "plus"} />
                </button>
                <time>
                  {task.dueAt ? timeInZurich(new Date(task.dueAt)) : "—"}
                  {task.dueAt && zurichDay(task.dueAt) !== today && <small>{shortDate(task.dueAt)}</small>}
                </time>
                <span className={`operations-timeline-icon ${tone}`}>
                  <ModuleIcon name="tasks" />
                </span>
                <div>
                  <strong>{task.title}</strong>
                  <small>
                    {[
                      task.residentName ? `${task.residentName}${task.room ? ` · ${task.room}` : ""}` : task.careUnit,
                      task.category,
                      task.recurrence !== "none" ? TASK_RECURRENCE[task.recurrence] : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                {team ? (
                  <span className="task-owner">
                    <span className="avatar">{task.assigneeName ? personInitials(task.assigneeName) : "–"}</span>
                    {task.assigneeName ?? "Nicht zugewiesen"}
                  </span>
                ) : (
                  <span className="task-owner">{TASK_PRIORITIES[task.priority].label}</span>
                )}
                <span className={`status-badge ${statusTone(task)}`}>{statusLabel(task)}</span>
                <button className="quiet-button" type="button" onClick={() => setDetail(task.id)}>
                  Details
                </button>
              </article>
            );
          })}
          {!data.loading && !filtered.length && (
            <div className="resident-empty">
              <ModuleIcon name="check" />
              <strong>Keine Aufgaben in diesem Filter</strong>
              <p>Filter zurücksetzen oder neue Aufgabe erstellen.</p>
            </div>
          )}
          {data.loading && !payload && <p className="list-hint">Aufgaben werden geladen …</p>}
        </div>
      </section>
      {detail && payload && (
        <TaskDetailDialog
          key={`${detail.id}-${detail.status}`}
          task={detail}
          canWrite={payload.canWrite}
          showToast={showToast}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setDetail(null);
            onEdit(detail);
          }}
          onToggle={() => {
            setDetail(null);
            finish(detail);
          }}
          onChanged={(message) => {
            setDetail(null);
            showToast(message);
            reload();
          }}
        />
      )}
      {detailId && payload && !detail && !data.loading && <MissingTask onClose={() => setDetail(null)} />}
      {dialog}
    </>
  );
}

export function MissingTask({ onClose }: { onClose: () => void }) {
  return (
    <EditorDialog
      id="task-missing"
      eyebrow="Aufgaben"
      title="Aufgabe nicht in dieser Liste"
      description="Die Aufgabe ist erledigt, abgebrochen oder einer anderen Person zugewiesen. In den Teamaufgaben findest du alle sichtbaren Aufgaben."
      onClose={onClose}
      onSubmit={onClose}
      saving={false}
      error=""
      submitLabel="Schliessen"
    >
      {null}
    </EditorDialog>
  );
}
