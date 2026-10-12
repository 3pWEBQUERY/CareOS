"use client";

import type { ReactNode } from "react";
import { DASHBOARD_SIZES, DashboardWidgetId, dashboardWidgets, widgetSpan, widgetText } from "./dashboard-shared";
import type { DashboardState } from "./use-dashboard";
import { CareOptionSelect } from "@/app/components/care-form-controls";

const sizeOptions = [
  { value: "", label: "Standard" },
  ...DASHBOARD_SIZES.map((size) => ({ value: size.id, label: size.label })),
];

// Ein Bereich des Arbeitsplatzes (Kopf- oder Hauptbereich) mit seinen sichtbaren Bausteinen.
export function DashboardArea({
  r,
  top,
  className,
  content,
}: {
  r: DashboardState;
  top: boolean;
  className: string;
  content: Record<DashboardWidgetId, ReactNode>;
}) {
  const { widgetOrder, hiddenWidgets, topWidgets, dashboardEditing, moveWidgetToArea } = r;
  const ids = widgetOrder.filter(
    (id) => topWidgets.includes(id) === top && !hiddenWidgets.includes(id) && content[id] !== null,
  );
  if (!ids.length && !dashboardEditing) return null;
  return (
    <div
      className={`${className} dashboard-area ${dashboardEditing ? "is-editing" : ""}`}
      onDragOver={(event) => dashboardEditing && event.preventDefault()}
      onDrop={() => moveWidgetToArea(top)}
    >
      {ids.map((id) => (
        <DashboardFrame key={id} r={r} id={id} top={top} first={id === ids[0]} last={id === ids.at(-1)}>
          {content[id]}
        </DashboardFrame>
      ))}
      {dashboardEditing && !ids.length && (
        <p className="dashboard-area-empty">
          {top ? "Kopfbereich ist leer – Bausteine hierher ziehen" : "Bausteine hierher ziehen"}
        </p>
      )}
    </div>
  );
}

function DashboardFrame({
  r,
  id,
  top,
  first,
  last,
  children,
}: {
  r: DashboardState;
  id: DashboardWidgetId;
  top: boolean;
  first: boolean;
  last: boolean;
  children: ReactNode;
}) {
  const {
    dashboardEditing,
    widgetSizes,
    draggedWidget,
    setDraggedWidget,
    moveWidget,
    moveWidgetBy,
    setWidgetSize,
    toggleWidgetArea,
    toggleWidget,
  } = r;
  const widget = dashboardWidgets.find((item) => item.id === id)!;
  const label = widgetText(widget, r.terms).label;
  return (
    <div
      className={`dashboard-widget span-${widgetSpan(id, widgetSizes)} ${draggedWidget === id ? "is-dragging" : ""}`}
      data-widget={id}
      draggable={dashboardEditing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        setDraggedWidget(id);
      }}
      onDragEnd={() => setDraggedWidget(null)}
      onDragOver={(event) => dashboardEditing && event.preventDefault()}
      onDrop={(event) => {
        event.stopPropagation();
        moveWidget(id);
      }}
    >
      {dashboardEditing && (
        <div className="dashboard-widget-handle">
          <span className="dashboard-widget-title" aria-hidden="true" title={label}>
            ⠿ <span>{label}</span>
          </span>
          <span className="dashboard-widget-tools" role="group" aria-label={`${label} anpassen`}>
            <button
              type="button"
              disabled={first}
              onClick={() => moveWidgetBy(id, -1)}
              aria-label={`${label} nach vorne`}
              title="Nach vorne"
            >
              ←
            </button>
            <button
              type="button"
              disabled={last}
              onClick={() => moveWidgetBy(id, 1)}
              aria-label={`${label} nach hinten`}
              title="Nach hinten"
            >
              →
            </button>
            <CareOptionSelect
              className="widget-size-select"
              label={`Breite von ${label}`}
              value={widgetSizes[id] ?? ""}
              options={sizeOptions}
              onChange={(value) => setWidgetSize(id, (value || null) as Parameters<typeof setWidgetSize>[1])}
            />
            <button
              type="button"
              onClick={() => toggleWidgetArea(id)}
              aria-label={`${label} ${top ? "in Hauptbereich" : "in Kopfbereich"}`}
              title={top ? "In den Hauptbereich" : "In den Kopfbereich"}
            >
              {top ? "▼" : "▲"}
            </button>
            <button
              type="button"
              onClick={() => toggleWidget(id)}
              aria-label={`${label} ausblenden`}
              title="Ausblenden"
            >
              ×
            </button>
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
