"use client";

import type { ReactNode } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { type ModuleIconName } from "@/app/components/module-icon";
import { ModuleIcon } from "@/app/components/module-icon";
import type { ShowToast } from "@/app/components/workspace-ui";

// Page frame and parts shared by the Personal workspaces (team news, learning, documents).

export type Tone = "stable" | "attention" | "critical" | "info";

export function PersonalFrame({
  module,
  child,
  view,
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  module: string;
  child: string;
  view: string;
  eyebrow: string;
  title: string;
  description: string;
  action?: { label: string; icon?: ModuleIconName; onClick: (showToast: ShowToast) => void } | null;
  children: (showToast: ShowToast) => ReactNode;
}) {
  return (
    <ModulePageShell
      activeModule={module}
      activeChild={child}
      pageClass={`governance-page governance-${view}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace governance-workspace">
          <section className="page-heading care-page-heading" aria-labelledby="governance-title">
            <div className="heading-copy">
              <p className="eyebrow">{eyebrow}</p>
              <h1 id="governance-title">{title}</h1>
              <p>{description}</p>
            </div>
            {action && (
              <button className="primary-button" type="button" onClick={() => action.onClick(showToast)}>
                <ModuleIcon name={action.icon ?? "plus"} className="button-icon" />
                {action.label}
              </button>
            )}
          </section>
          {children(showToast)}
        </main>
      )}
    </ModulePageShell>
  );
}

export function PersonalSummary({
  items,
}: {
  items: Array<{ icon: ModuleIconName; value: string; label: string; tone?: Tone }>;
}) {
  return (
    <section className="wound-summary operations-summary governance-summary" aria-label="Zusammenfassung">
      {items.map((item) => (
        <div key={item.label}>
          <span
            className={`summary-icon ${item.tone === "attention" ? "attention" : item.tone === "critical" ? "critical" : item.tone === "info" ? "info" : ""}`}
          >
            <ModuleIcon name={item.icon} />
          </span>
          <span>
            <strong>{item.value}</strong>
            <small>{item.label}</small>
          </span>
        </div>
      ))}
    </section>
  );
}

export function SearchField({
  label,
  query,
  setQuery,
  placeholder,
}: {
  label: string;
  query: string;
  setQuery: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="resident-search">
      <ModuleIcon name="search" />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

// "vor 5 Min.", "Heute, 08:14", "Gestern, 17:02" or "12.09.2026".
export function relativeTime(value: string, now: number) {
  const date = new Date(value);
  const minutes = Math.round((now - date.getTime()) / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(d);
  const time = date.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
  if (day(date) === day(new Date(now))) return `Heute, ${time}`;
  if (day(date) === day(new Date(now - 86_400_000))) return `Gestern, ${time}`;
  return date.toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Zurich",
  });
}
