"use client";

import { dashboardWidgets, widgetText } from "./dashboard-shared";
import type { DashboardState } from "./use-dashboard";

export function DashboardCustomizer({ r }: { r: DashboardState }) {
  const { hiddenWidgets, toggleWidget, resetDashboardLayout } = r;
  return (
    <section className="dashboard-customizer" aria-label="Startseite anpassen">
      <div>
        <p className="eyebrow">Bausteine</p>
        <h2>Arbeitsplatz anpassen</h2>
        <p>
          Bausteine ziehen oder mit ← → verschieben, die Breite wählen, mit ▲ ▼ zwischen Kopf- und Hauptbereich wechseln
          und hier ein- oder ausblenden.
        </p>
      </div>
      <div className="dashboard-customizer-list">
        {dashboardWidgets.map((widget) => (
          <button
            className={!hiddenWidgets.includes(widget.id) ? "active" : ""}
            type="button"
            key={widget.id}
            onClick={() => toggleWidget(widget.id)}
          >
            <span>{!hiddenWidgets.includes(widget.id) ? "✓" : "+"}</span>
            <div>
              <strong>{widgetText(widget, r.terms).label}</strong>
              <small>{widgetText(widget, r.terms).description}</small>
            </div>
          </button>
        ))}
      </div>
      <button className="quiet-button" type="button" onClick={resetDashboardLayout}>
        Standard wiederherstellen
      </button>
    </section>
  );
}
