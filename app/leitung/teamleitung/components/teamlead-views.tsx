"use client";

import { Archive, ArrowClockwise, DotsThree, PencilSimple, UsersThree } from "@phosphor-icons/react";
import { SidebarTooltip } from "@/app/components/app-sidebar";
import { TeamleadRow, initials, labelRole } from "./teamlead-utils";

export function EmployeesView({
  rows,
  isArchived,
  onUpdate,
  onSelect,
}: {
  rows: TeamleadRow[];
  isArchived: (row: TeamleadRow) => boolean;
  onUpdate: (id: string, action: "archive" | "restore") => void;
  onSelect: (employee: TeamleadRow) => void;
}) {
  return (
    <section className="teamlead-grid teamlead-employees-grid">
      <article className="teamlead-panel">
        <div className="teamlead-panel-head">
          <div>
            <p className="eyebrow">TEAMVERZEICHNIS</p>
            <h2>Mitarbeitende & Rollen</h2>
            <span>{rows.length} Profile im Überblick</span>
          </div>
          <button type="button" className="teamlead-icon-button" aria-label="Weitere Optionen">
            <DotsThree />
          </button>
        </div>
        <div className="teamlead-table teamlead-employee-table">
          <div className="teamlead-table-head">
            <span>Mitarbeiter</span>
            <span>Rolle</span>
            <span>Arbeitsplatz</span>
            <span>Status</span>
            <span>Aktionen</span>
          </div>
          {rows.map((row) => (
            <div
              className="teamlead-table-row teamlead-employee-row"
              role="button"
              tabIndex={0}
              key={row.id}
              onClick={() => onSelect(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row);
                }
              }}
            >
              <div className="teamlead-person">
                <b>{initials(row.display_name)}</b>
                <span>
                  <strong>{row.display_name}</strong>
                  <small>@{row.username}</small>
                </span>
              </div>
              <span className="teamlead-role">{labelRole(row.role)}</span>
              <span>{row.care_unit_name || "Kein fester Bereich"}</span>
              <span className={`teamlead-status ${isArchived(row) ? "archived" : "active"}`}>
                <i />
                {isArchived(row) ? "Archiviert" : "Aktiv"}
              </span>
              <span className="teamlead-row-actions">
                <button
                  className="teamlead-row-icon"
                  type="button"
                  aria-label={`${row.display_name} bearbeiten`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(row);
                  }}
                >
                  <PencilSimple />
                  <SidebarTooltip label="Mitarbeiter bearbeiten" />
                </button>
                <button
                  className="teamlead-row-icon"
                  type="button"
                  aria-label={
                    isArchived(row) ? `${row.display_name} wiederherstellen` : `${row.display_name} archivieren`
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    onUpdate(row.id, isArchived(row) ? "restore" : "archive");
                  }}
                >
                  {isArchived(row) ? <ArrowClockwise /> : <Archive />}
                  <SidebarTooltip
                    label={isArchived(row) ? "Mitarbeiter wiederherstellen" : "Mitarbeiter archivieren"}
                  />
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>
      <aside className="teamlead-aside">
        <article className="teamlead-panel teamlead-role-card">
          <p className="eyebrow">ROLLEN & ZUGRIFFE</p>
          <h2>Verteilung im Team</h2>
          <div className="teamlead-role-breakdown">
            {["leitung", "pflege", "arzt", "mitarbeitende:r"].map((role) => (
              <div key={role}>
                <span>
                  <i className={`role-dot ${role}`} />
                  {labelRole(role)}
                </span>
                <strong>{rows.filter((row) => row.role === role && !isArchived(row)).length}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="teamlead-info-card">
          <UsersThree />
          <div>
            <strong>Team aktuell halten</strong>
            <p>Klicke auf ein Profil, um Rolle, Arbeitsbereich und Archivstatus zu verwalten.</p>
          </div>
        </article>
      </aside>
    </section>
  );
}
