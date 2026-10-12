"use client";

import { type CSSProperties } from "react";
import { Icon, Timeline } from "./dashboard-shared";
import type { DashboardState } from "./use-dashboard";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

export function DashboardSummaryStrip({ r }: { r: DashboardState }) {
  const { tasks, assignedResidents } = r;
  return (
    <section className="summary-strip" aria-label="Schichtübersicht">
      <div className="summary-item">
        <span className="summary-icon">
          <Icon name="residents" />
        </span>
        <span>
          <strong className="summary-value">{assignedResidents.length}</strong>
          <span className="summary-label">{r.terms.many} zugeteilt</span>
        </span>
      </div>
      <div className="summary-item">
        <span className="summary-icon">
          <Icon name="tasks" />
        </span>
        <span>
          <strong className="summary-value">{tasks.length}</strong>
          <span className="summary-label">Aufgaben geplant</span>
        </span>
      </div>
      <div className="summary-item">
        <span className="summary-icon attention">
          <Icon name="pulse" />
        </span>
        <span>
          <strong className="summary-value">{assignedResidents.filter((item) => item.critical).length}</strong>
          <span className="summary-label">wichtige Hinweise</span>
        </span>
      </div>
      <div className="summary-item">
        <span className="summary-icon info">
          <Icon name="handover" />
        </span>
        <span>
          <strong className="summary-value">{tasks.filter((item) => !item.completed).length}</strong>
          <span className="summary-label">Aufgaben offen</span>
        </span>
      </div>
    </section>
  );
}

export function DashboardCriticalAlert({ r }: { r: DashboardState }) {
  const { router, criticalChange } = r;
  if (!criticalChange) return null;
  return (
    <section className="critical-alert" aria-label="Kritischer Hinweis">
      <span className="critical-symbol">
        <Icon name="alert" />
      </span>
      <div>
        <strong>Unmittelbar prüfen · {criticalChange.name}</strong>
        <p>{criticalChange.note}</p>
      </div>
      <button className="secondary-button" type="button" onClick={() => router.push("/c/pflegedokumentation/verlauf")}>
        Verlauf öffnen <Icon name="chevron" className="button-icon" />
      </button>
    </section>
  );
}

export function DashboardTimelineCard({ r }: { r: DashboardState }) {
  const { router, nextTasks, currentScope } = r;
  return (
    <section className="card timeline-card" aria-labelledby="timeline-title">
      <div className="card-header">
        <div>
          <h2 className="card-title" id="timeline-title">
            Zeitplan
          </h2>
          <p className="card-subtitle">Deine nächsten terminierten Aufgaben</p>
        </div>
        <button className="quiet-button" type="button" onClick={() => router.push("/c/betrieb/aufgaben")}>
          Aufgaben ansehen
        </button>
      </div>
      <div className="timeline-list">
        {nextTasks.length ? (
          nextTasks.map((task, index) => (
            <Timeline
              key={task.id}
              time={task.time}
              title={task.title}
              detail={task.resident || currentScope}
              state={task.overdue ? "Überfällig" : "Geplant"}
              rail={index < nextTasks.length - 1}
            />
          ))
        ) : (
          <p className="home-widget-empty">Keine terminierten Aufgaben offen.</p>
        )}
      </div>
    </section>
  );
}

export function DashboardTasksCard({ r }: { r: DashboardState }) {
  const { router, tasks, progress, toggleTask } = r;
  return (
    <section className="card tasks-card" aria-labelledby="tasks-title">
      <div className="card-header">
        <div>
          <h2 className="card-title" id="tasks-title">
            Als Nächstes
          </h2>
          <p className="card-subtitle">{tasks.filter((task) => !task.completed).length} Aufgaben offen</p>
        </div>
        <div
          className="progress-ring"
          style={{ "--progress": `${progress}%` } as CSSProperties}
          aria-label={`${progress} Prozent erledigt`}
        >
          <span>{progress}%</span>
        </div>
      </div>
      <div className="dashboard-task-list">
        {tasks.map((task) => (
          <div className={`dashboard-task-row ${task.completed ? "completed" : ""}`} key={task.id}>
            <button
              className="dashboard-task-check"
              type="button"
              aria-label={`${task.title} ${task.completed ? "wieder öffnen" : "erledigen"}`}
              onClick={() => void toggleTask(task.id)}
            >
              <Icon name="check" />
            </button>
            <span className="dashboard-task-copy">
              <strong className="dashboard-task-title">{task.title}</strong>
              <span className="dashboard-task-resident">{task.resident}</span>
            </span>
            <time className={`dashboard-task-time ${task.overdue && !task.completed ? "overdue" : ""}`}>
              {task.time}
            </time>
          </div>
        ))}
      </div>
      <div className="tasks-footer">
        <button className="quiet-button" type="button" onClick={() => router.push("/c/betrieb/aufgaben")}>
          Alle Aufgaben <Icon name="chevron" className="button-icon" />
        </button>
      </div>
    </section>
  );
}

export function DashboardResidentsCard({ r }: { r: DashboardState }) {
  const { router, assignedResidents, currentScope } = r;
  return (
    <section className="card residents-card" aria-labelledby="residents-title">
      <div className="card-header">
        <div>
          <h2 className="card-title" id="residents-title">
            {r.terms.many} im Blick
          </h2>
          <p className="card-subtitle">
            {assignedResidents.length} in {currentScope}
          </p>
        </div>
        <button className="quiet-button" type="button" onClick={() => router.push("/c/bewohner")}>
          Verzeichnis öffnen
        </button>
      </div>
      <div className="resident-grid">
        {assignedResidents.map((resident) => (
          <button
            className="resident-tile"
            type="button"
            key={resident.name}
            onClick={() => router.push("/c/bewohner")}
          >
            <span className={`resident-avatar ${resident.critical ? "critical" : ""}`}>{resident.initials}</span>
            <span>
              <strong>
                {resident.name} <ResuscitationBadge residentId={resident.id} />
              </strong>
              <p>
                {resident.room} · <span className="risk-label">{resident.risk}</span>
              </p>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
