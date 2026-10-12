"use client";

import { Archive, ArrowClockwise, ClipboardText } from "@phosphor-icons/react";
import { TeamleadRow, priorityLabel, formatDate } from "./teamlead-utils";

export function TasksView({
  rows,
  isArchived,
  onUpdate,
}: {
  rows: TeamleadRow[];
  isArchived: (row: TeamleadRow) => boolean;
  onUpdate: (id: string, action: "archive" | "restore") => void;
}) {
  const open = rows.filter((row) => !isArchived(row));
  const archived = rows.filter(isArchived);
  return (
    <section className="teamlead-task-layout">
      <article className="teamlead-panel">
        <div className="teamlead-panel-head">
          <div>
            <p className="eyebrow">AUFGABENBOARD</p>
            <h2>Teamaufgaben steuern</h2>
            <span>Prioritäten und Verantwortung transparent koordinieren</span>
          </div>
          <button type="button" className="secondary-button">
            Alle Aufgaben
          </button>
        </div>
        <div className="teamlead-kanban">
          <TaskColumn title="Aktiv" count={open.length} rows={open} onUpdate={onUpdate} />
          <TaskColumn title="Archiv" count={archived.length} rows={archived} onUpdate={onUpdate} archived />
        </div>
      </article>
      <article className="teamlead-info-card">
        <ClipboardText />
        <div>
          <strong>Klare Zuständigkeit</strong>
          <p>Neue Aufgaben können direkt einer Person zugewiesen und mit einer Fälligkeit versehen werden.</p>
        </div>
      </article>
    </section>
  );
}

export function TaskColumn({
  title,
  count,
  rows,
  onUpdate,
  archived = false,
}: {
  title: string;
  count: number;
  rows: TeamleadRow[];
  onUpdate: (id: string, action: "archive" | "restore") => void;
  archived?: boolean;
}) {
  return (
    <section className="teamlead-task-column">
      <header>
        <span>{title}</span>
        <b>{count}</b>
      </header>
      <div>
        {rows.map((row) => (
          <article className="teamlead-task-card" key={row.id}>
            <div>
              <span className={`priority-mark ${row.priority ?? "normal"}`} />
              <small>{priorityLabel(row.priority)}</small>
            </div>
            <strong>{row.title}</strong>
            <p>{row.description || "Keine zusätzliche Beschreibung"}</p>
            <footer>
              <span>{row.assignee || "Nicht zugewiesen"}</span>
              <time>{formatDate(row.due_at)}</time>
            </footer>
            <button type="button" onClick={() => onUpdate(row.id, archived ? "restore" : "archive")}>
              {archived ? <ArrowClockwise /> : <Archive />}
              {archived ? "Wiederherstellen" : "Archivieren"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
