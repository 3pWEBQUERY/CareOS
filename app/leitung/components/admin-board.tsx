"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ModuleIcon, type ModuleIconName } from "@/app/components/module-icon";
import { formatDateTime, useApiData } from "@/app/components/workspace-ui";
import type { AdminOverview, AdminView } from "@/lib/admin-overview";

const ADMIN_CHANGED = "carecore:admin-changed";

// Organisation, staff or settings changed: the board reloads its figures and log.
export const notifyAdminChanged = () => window.dispatchEvent(new Event(ADMIN_CHANGED));
// Auf Änderungen der Administration hören (Rückgabe meldet ab).
export function onAdminChanged(listener: () => void) {
  window.addEventListener(ADMIN_CHANGED, listener);
  return () => window.removeEventListener(ADMIN_CHANGED, listener);
}

const SERIES_CLASSES = ["quality", "plan", "actual"];

function iconFor(href: string): ModuleIconName {
  if (href.includes("konfiguration")) return "settings";
  if (href.includes("mitarbeiter")) return "team";
  if (href.includes("bewohner")) return "residents";
  if (href.includes("pflegebedarf")) return "docs";
  if (href.endsWith("/leitung/administration")) return "building";
  if (href.includes("qualitaet")) return "quality";
  if (href.includes("medikation")) return "med";
  if (href.includes("pflegeplanung")) return "plan";
  if (href.includes("wund")) return "wounds";
  if (href.includes("vitalwerte")) return "vitals";
  if (href.includes("aufgaben")) return "tasks";
  if (href.includes("uebergabe")) return "handover";
  return "docs";
}

function when(value: string) {
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
  return today ? `Heute, ${time}` : formatDateTime(value);
}

// Lower part of the administration pages: development of the last six weeks,
// open administrative to-dos and the change log with details.
export function AdminBoard({ view }: { view: AdminView }) {
  const router = useRouter();
  const overview = useApiData<AdminOverview>(`/api/admin/overview?view=${view}`);
  const { reload } = overview;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    window.addEventListener(ADMIN_CHANGED, reload);
    return () => window.removeEventListener(ADMIN_CHANGED, reload);
  }, [reload]);

  const data = overview.data;
  const log = useMemo(() => data?.log ?? [], [data]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-CH");
    return log.filter((entry) =>
      `${entry.title} ${entry.area} ${entry.subject} ${entry.actor}`.toLocaleLowerCase("de-CH").includes(needle),
    );
  }, [log, query]);
  const selectedIndex = Math.max(
    0,
    visible.findIndex((entry) => entry.id === selectedId),
  );
  const selected = visible[selectedIndex] ?? null;
  const maxima = (data?.trend.series ?? []).map((series) => Math.max(1, ...series));

  return (
    <div className="leadership-board legacy-leadership-board">
      <section className="card leadership-radar">
        <div className="card-header">
          <div>
            <p className="eyebrow">Management Cockpit</p>
            <h2 className="card-title">{data?.trend.title ?? "Entwicklung im Zeitraum"}</h2>
            <p className="card-subtitle">{data?.trend.subtitle ?? "Wird geladen …"}</p>
          </div>
          <span className="filter-pill">6 Wochen</span>
        </div>
        <div className="leadership-bars" aria-label="Kennzahlenverlauf">
          {(data?.trend.series ?? [[], [], []]).map((series, index) => (
            <div key={index}>
              {series.map((value, week) => (
                <span
                  key={week}
                  style={{ height: `${Math.max(3, Math.round((value / maxima[index]) * 92))}%` }}
                  title={`${data?.trend.weeks[week]}: ${value}`}
                />
              ))}
              <small>{data?.trend.labels[index] ?? ""}</small>
            </div>
          ))}
        </div>
        <div className="leadership-chart-legend">
          {(data?.trend.labels ?? []).map((label, index) => (
            <span key={label}>
              <i className={SERIES_CLASSES[index]} />
              {label} {data ? `· ${data.trend.series[index].at(-1)} diese Woche` : ""}
            </span>
          ))}
        </div>
      </section>
      <section className="card leadership-priority">
        <div className="card-header">
          <div>
            <p className="eyebrow">Führungskreis</p>
            <h2 className="card-title">Prioritäten heute</h2>
          </div>
          {data && (
            <span className={`status-badge ${data.priorities.length ? "attention" : "stable"}`}>
              {data.priorities.length ? `${data.priorities.length} offen` : "Alles erledigt"}
            </span>
          )}
        </div>
        <div className="leadership-priority-list">
          {data?.priorities.map((item) => (
            <button type="button" key={item.id} onClick={() => router.push(item.href)}>
              <span className={`governance-icon ${item.tone}`}>
                <ModuleIcon name={item.tone === "critical" ? "alert" : iconFor(item.href)} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <ModuleIcon name="chevron" className="chevron" />
            </button>
          ))}
          {data && !data.priorities.length && (
            <div className="resident-empty">
              <ModuleIcon name="check" />
              <strong>Keine offenen Punkte</strong>
              <p>Organisation, Mitarbeitende und Einstellungen sind vollständig.</p>
            </div>
          )}
        </div>
      </section>
      <section className="card leadership-register" id="admin-log">
        <div className="operations-toolbar">
          <div>
            <p className="eyebrow">Arbeitsliste</p>
            <h2 className="card-title">Änderungsprotokoll</h2>
            <p className="card-subtitle">{overview.error ?? `${visible.length} von ${log.length} Einträgen`}</p>
          </div>
          <label className="resident-search">
            <ModuleIcon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Suchen…"
              aria-label="Änderungsprotokoll durchsuchen"
            />
          </label>
        </div>
        <div className="leadership-register-list">
          {visible.map((entry) => (
            <button
              className={selected?.id === entry.id ? "selected" : ""}
              type="button"
              key={entry.id}
              onClick={() => setSelectedId(entry.id)}
            >
              <span className="governance-icon info">
                <ModuleIcon name={entry.href ? iconFor(entry.href) : "docs"} />
              </span>
              <span>
                <strong>{entry.title}</strong>
                <small>{[entry.subject, entry.actor].filter(Boolean).join(" · ")}</small>
              </span>
              <span>
                <strong>{when(entry.at)}</strong>
                <small>{entry.area}</small>
              </span>
              <ModuleIcon name="chevron" className="chevron" />
            </button>
          ))}
          {data && visible.length === 0 && (
            <div className="resident-empty">
              <ModuleIcon name="search" />
              <strong>{log.length ? "Keine Einträge gefunden" : "Noch keine Änderungen"}</strong>
              <p>{log.length ? "Suchbegriff anpassen." : "Änderungen erscheinen hier automatisch."}</p>
            </div>
          )}
        </div>
      </section>
      <section className="card leadership-decision">
        <div className="card-header">
          <div>
            <p className="eyebrow">Änderung</p>
            <h2 className="card-title">{selected ? selected.title : "Kein Eintrag gewählt"}</h2>
          </div>
          {selected && <span className="status-badge info">{selected.area}</span>}
        </div>
        {selected && (
          <>
            <div className="leadership-decision-body">
              <p>{selected.subject || "Ohne Bezeichnung"}</p>
              <div>
                <span>Zeitpunkt</span>
                <strong>{formatDateTime(selected.at)}</strong>
              </div>
              <div>
                <span>Verantwortung</span>
                <strong>{selected.actor}</strong>
              </div>
              {selected.changes.map((change) => (
                <div key={change.field}>
                  <span>{change.field}</span>
                  <strong>{change.before === "–" ? change.after : `${change.before} → ${change.after}`}</strong>
                </div>
              ))}
            </div>
            <div className="leadership-decision-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!selected.href}
                onClick={() => selected.href && router.push(selected.href)}
              >
                Bereich öffnen
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={visible.length < 2}
                onClick={() => setSelectedId(visible[(selectedIndex + 1) % visible.length].id)}
              >
                Nächster Eintrag
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
