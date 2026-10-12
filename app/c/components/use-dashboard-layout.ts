"use client";

import { useEffect, useRef, useState } from "react";
import {
  DashboardLayoutState,
  DashboardWidgetId,
  DashboardWidgetSize,
  dashboardLayoutStorageKey,
  defaultDashboardLayout,
  readStoredDashboardLayout,
  sanitizeDashboardLayout,
} from "./dashboard-shared";

// Arbeitsplatz: Reihenfolge, Kopf- oder Hauptbereich, Breite und ausgeblendete Bausteine je Person.
// Gespeichert im Browser (sofort) und in der Datenbank (geräteübergreifend).
export function useDashboardLayout() {
  const [dashboardEditing, setDashboardEditing] = useState(false);
  const [layout, setLayout] = useState<DashboardLayoutState>(readStoredDashboardLayout);
  const [draggedWidget, setDraggedWidget] = useState<DashboardWidgetId | null>(null);
  // Speichern nacheinander: bei schnellen Änderungen darf ein älterer Stand nie den neueren überschreiben.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  // Hat die Person schon geändert, überschreibt das (später eintreffende) gespeicherte Layout ihre Änderung nicht.
  const changed = useRef(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/dashboard/layout", { credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<{ layout: unknown }>) : null))
      .then((payload) => {
        if (active && !changed.current && payload?.layout) setLayout(sanitizeDashboardLayout(payload.layout));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Änderungen an den Server nacheinander senden.
  function save(init: RequestInit) {
    changed.current = true;
    saving.current = saving.current
      .then(() => fetch("/api/dashboard/layout", { credentials: "same-origin", ...init }))
      .catch(() => undefined);
  }

  function persist(next: DashboardLayoutState) {
    setLayout(next);
    try {
      window.localStorage.setItem(dashboardLayoutStorageKey, JSON.stringify(next));
    } catch {
      // Ohne Browser-Speicher bleibt das Layout in der Datenbank.
    }
    save({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
  }

  const inTop = (id: DashboardWidgetId) => layout.top.includes(id);

  function toggleWidget(widgetId: DashboardWidgetId) {
    const hidden = layout.hidden.includes(widgetId)
      ? layout.hidden.filter((id) => id !== widgetId)
      : [...layout.hidden, widgetId];
    persist({ ...layout, hidden });
  }

  // Ziehen und Ablegen: der gezogene Baustein kommt vor das Ziel und in dessen Bereich.
  function moveWidget(targetId: DashboardWidgetId) {
    if (!draggedWidget || draggedWidget === targetId) return;
    const order = layout.order.filter((id) => id !== draggedWidget);
    order.splice(order.indexOf(targetId), 0, draggedWidget);
    const top = layout.top.filter((id) => id !== draggedWidget);
    persist({ ...layout, order, top: inTop(targetId) ? [...top, draggedWidget] : top });
  }

  // Ablegen auf freier Fläche eines Bereichs: ans Ende dieses Bereichs.
  function moveWidgetToArea(top: boolean) {
    if (!draggedWidget) return;
    const order = [...layout.order.filter((id) => id !== draggedWidget), draggedWidget];
    const rest = layout.top.filter((id) => id !== draggedWidget);
    persist({ ...layout, order, top: top ? [...rest, draggedWidget] : rest });
  }

  // Pfeil-Knöpfe (Tastatur und Touch): mit dem nächsten sichtbaren Baustein im selben Bereich tauschen.
  function moveWidgetBy(widgetId: DashboardWidgetId, step: -1 | 1) {
    const sameArea = layout.order.filter((id) => !layout.hidden.includes(id) && inTop(id) === inTop(widgetId));
    const neighbour = sameArea[sameArea.indexOf(widgetId) + step];
    if (!neighbour) return;
    const order = [...layout.order];
    const a = order.indexOf(widgetId);
    const b = order.indexOf(neighbour);
    [order[a], order[b]] = [order[b], order[a]];
    persist({ ...layout, order });
  }

  function setWidgetSize(widgetId: DashboardWidgetId, size: DashboardWidgetSize | null) {
    const sizes = { ...layout.sizes };
    if (size) sizes[widgetId] = size;
    else delete sizes[widgetId];
    persist({ ...layout, sizes });
  }

  function toggleWidgetArea(widgetId: DashboardWidgetId) {
    const top = inTop(widgetId) ? layout.top.filter((id) => id !== widgetId) : [...layout.top, widgetId];
    persist({ ...layout, top });
  }

  function resetDashboardLayout() {
    setLayout(defaultDashboardLayout());
    try {
      window.localStorage.removeItem(dashboardLayoutStorageKey);
    } catch {
      // Ohne Browser-Speicher genügt das Löschen in der Datenbank.
    }
    save({ method: "DELETE" });
  }

  return {
    dashboardEditing,
    setDashboardEditing,
    widgetOrder: layout.order,
    hiddenWidgets: layout.hidden,
    topWidgets: layout.top,
    widgetSizes: layout.sizes,
    draggedWidget,
    setDraggedWidget,
    toggleWidget,
    resetDashboardLayout,
    moveWidget,
    moveWidgetBy,
    moveWidgetToArea,
    setWidgetSize,
    toggleWidgetArea,
  };
}
