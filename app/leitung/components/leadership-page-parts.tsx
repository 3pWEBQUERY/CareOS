"use client";

import { ModuleIcon } from "@/app/components/module-icon";
import type { Tone } from "./leadership-data";

export type Kpi = { value: string; label: string; note: string; tone?: Tone };

// Heading and KPI row shared by the database-backed leadership pages.
export function LeadershipHeading({
  eyebrow,
  title,
  description,
  action,
  customize,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void; icon?: "plus" | "docs" };
  // Einrichtbare Seite: Knopf „Ansicht anpassen“ / „Fertig“.
  customize?: { editing: boolean; onToggle: () => void };
}) {
  const button = action && (
    <button className="primary-button" type="button" onClick={action.onClick}>
      <ModuleIcon name={action.icon ?? "plus"} className="button-icon" />
      {action.label}
    </button>
  );
  return (
    <section className="leadership-heading page-heading">
      <div className="heading-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {customize ? (
        <div className="leadership-heading-actions">
          <button
            className="secondary-button leadership-customize-button"
            type="button"
            aria-pressed={customize.editing}
            aria-label={customize.editing ? undefined : "Ansicht anpassen"}
            title={customize.editing ? undefined : "Ansicht anpassen"}
            onClick={customize.onToggle}
          >
            <ModuleIcon name="settings" className="button-icon" />
            {customize.editing && "Fertig"}
          </button>
          {button}
        </div>
      ) : (
        button
      )}
    </section>
  );
}

export function LeadershipKpis({ kpis }: { kpis: Kpi[] }) {
  return (
    <section className="leadership-kpis" aria-label="Leitungskennzahlen">
      {kpis.map((kpi) => (
        <article key={kpi.label} className={kpi.tone ? `leadership-kpi ${kpi.tone}` : "leadership-kpi"}>
          <span className="leadership-kpi-value">{kpi.value}</span>
          <strong>{kpi.label}</strong>
          <small>{kpi.note}</small>
        </article>
      ))}
    </section>
  );
}

export const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
