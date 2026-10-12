"use client";

import { CareOptionSelect } from "@/app/components/care-form-controls";
import Link from "next/link";
import { useMemo, useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import { LoadError, formatDate, formatDateTime, useApiData } from "@/app/components/workspace-ui";
import {
  HISTORY_STATUSES,
  type HistoryDetail,
  type HistoryFilter,
  type HistoryOverview,
  type HistoryResident,
} from "@/lib/resident-history-shared";
import { StayDialog, type StayDialogMode } from "./stay-dialog";
import { useCareResident, useTerms } from "@/app/components/care-context";
import type { Terms } from "@/lib/terminology";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

const ALL_UNITS = "Gesamtes Haus";
const isArchived = (resident: HistoryResident) => resident.status === "Ausgetreten" || resident.status === "Verstorben";

function periodOf(resident: HistoryResident) {
  if (resident.status === "Verstorben") return `Verstorben ${formatDate(resident.endedOn)}`;
  if (resident.status === "Ausgetreten") return `Austritt ${formatDate(resident.endedOn)}`;
  if (resident.status === "Verlegt") return `Verlegt am ${formatDate(resident.endedOn)}`;
  if (resident.status === "Geplant") return `Eintritt geplant ${formatDate(resident.admittedOn)}`;
  return `Eintritt ${formatDate(resident.admittedOn)}`;
}

const avatarTone = (resident: HistoryResident) =>
  resident.tone === "critical" ? "critical" : resident.tone === "archived" ? "archived" : "";

// Downloads the filtered list as CSV (semicolon separated for Excel with Swiss locale).
function downloadReport(residents: HistoryResident[], t: Terms) {
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = [
    [t.one, "Zimmer", "Wohnbereich", "Status", "Zeitraum", "Letzter Eintrag", "Datum", "Erfasst von", "Einträge"],
    ...residents.map((resident) => [
      resident.name,
      resident.room,
      resident.careUnit,
      resident.status,
      periodOf(resident),
      resident.lastEntry?.title ?? "",
      resident.lastEntry ? formatDateTime(resident.lastEntry.occurredAt) : "",
      resident.lastEntry?.author ?? "",
      String(resident.entryCount),
    ]),
  ];
  const blob = new Blob([`﻿${lines.map((line) => line.map(cell).join(";")).join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `hausbericht-bewohner-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function ResidentHistoryPage() {
  const t = useTerms();
  const [status, setStatus] = useState<HistoryFilter>("Alle");
  const [unit, setUnit] = useState(ALL_UNITS);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useCareResident();
  const [dialog, setDialog] = useState<StayDialogMode | null>(null);

  const overview = useApiData<HistoryOverview>("/api/resident-history");
  const residents = useMemo(() => overview.data?.residents ?? [], [overview.data]);
  const units = [ALL_UNITS, ...(overview.data?.units ?? [])];
  const filteredResidents = useMemo(
    () =>
      residents.filter((resident) => {
        const matchesStatus = status === "Alle" || resident.status === status;
        const matchesUnit = unit === ALL_UNITS || resident.careUnit === unit;
        const searchable =
          `${resident.name} ${resident.room} ${resident.careUnit} ${resident.status} ${resident.lastEntry?.title ?? ""} ${resident.lastEntry?.body ?? ""}`.toLocaleLowerCase(
            "de-CH",
          );
        return matchesStatus && matchesUnit && searchable.includes(query.trim().toLocaleLowerCase("de-CH"));
      }),
    [query, residents, status, unit],
  );
  const selected = residents.find((resident) => resident.id === selectedId) ?? residents[0] ?? null;
  const detail = useApiData<HistoryDetail>(selected ? `/api/resident-history/${selected.id}` : null);
  const count = (item: HistoryFilter) => residents.filter((resident) => resident.status === item).length;
  const archived = selected ? isArchived(selected) : false;
  const canWrite = overview.data?.canWrite ?? false;

  function resetFilters() {
    setStatus("Alle");
    setUnit(ALL_UNITS);
    setQuery("");
  }

  return (
    <ModulePageShell
      activeModule="residents"
      activeChild="Verlauf & Archiv"
      pageClass="resident-history-page"
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace">
          <section className="page-heading residents-heading" aria-labelledby="resident-history-title">
            <div className="heading-copy">
              <p className="eyebrow">CareOS {t.many}</p>
              <h1 id="resident-history-title">{t.prefix}verlauf &amp; Archiv</h1>
              <p>Alle aktiven und ehemaligen {t.prefix}akten des gesamten Hauses an einem Ort.</p>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={!filteredResidents.length}
              onClick={() => {
                downloadReport(filteredResidents, t);
                showToast(`Hausbericht mit ${filteredResidents.length} Akten heruntergeladen`);
              }}
            >
              <ModuleIcon name="docs" className="button-icon" />
              Hausbericht erstellen
            </button>
          </section>

          <section className="wound-summary" aria-label={`Hausweite ${t.prefix}übersicht`}>
            <div>
              <span className="summary-icon">
                <ModuleIcon name="residents" />
              </span>
              <span>
                <strong>{residents.length}</strong>
                <small>{t.prefix}akten gesamt</small>
              </span>
            </div>
            <div>
              <span className="summary-icon">
                <ModuleIcon name="check" />
              </span>
              <span>
                <strong>{count("Aktiv")}</strong>
                <small>aktuell im Haus</small>
              </span>
            </div>
            <div>
              <span className="summary-icon info">
                <ModuleIcon name="handover" />
              </span>
              <span>
                <strong>{count("Ausgetreten") + count("Verlegt")}</strong>
                <small>ausgetreten oder verlegt</small>
              </span>
            </div>
            <div>
              <span className="summary-icon archived">
                <ModuleIcon name="docs" />
              </span>
              <span>
                <strong>{count("Verstorben")}</strong>
                <small>verstorben · archiviert</small>
              </span>
            </div>
          </section>

          {overview.error && <LoadError message={overview.error} onRetry={overview.reload} />}

          <section className="house-scope-note" aria-label="Umfang der Ansicht">
            <span>
              <ModuleIcon name="building" />
            </span>
            <div>
              <strong>Gesamtes Haus</strong>
              <p>
                Die Ansicht umfasst alle Wohnbereiche sowie aktive, geplante, verlegte, ausgetretene und verstorbene
                {t.many}.
              </p>
            </div>
            <button className="quiet-button" type="button" onClick={resetFilters}>
              Alle Filter zurücksetzen
            </button>
          </section>

          <div className="house-history-layout">
            <section className="card house-resident-directory" aria-labelledby="house-residents-title">
              <div className="house-history-toolbar">
                <div>
                  <h2 className="card-title" id="house-residents-title">
                    {t.prefix}akten
                  </h2>
                  <p className="card-subtitle">
                    {overview.loading && !overview.data
                      ? `${t.prefix}akten werden geladen …`
                      : `${filteredResidents.length} von ${residents.length} Akten angezeigt`}
                  </p>
                </div>
                <label className="resident-search">
                  <ModuleIcon name="search" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Name, Zimmer oder Eintrag suchen"
                    aria-label={`Alle ${t.prefix}akten durchsuchen`}
                  />
                </label>
                <label className="house-unit-filter">
                  <span>Wohnbereich</span>
                  <CareOptionSelect
                    label="Wohnbereich filtern"
                    value={unit}
                    options={units.map((item) => ({ value: item, label: item }))}
                    onChange={setUnit}
                  />
                </label>
                <div className="house-status-filters" aria-label="Aktenstatus filtern">
                  {HISTORY_STATUSES.map((item) => (
                    <button
                      className={status === item ? "active" : ""}
                      type="button"
                      key={item}
                      aria-pressed={status === item}
                      onClick={() => setStatus(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="house-resident-table-head" aria-hidden="true">
                <span>{t.one}</span>
                <span>Wohnbereich</span>
                <span>Aufenthalt</span>
                <span>Letzter Eintrag</span>
                <span>Status</span>
                <span />
              </div>
              <div className="house-resident-list">
                {filteredResidents.map((resident) => (
                  <button
                    className={`house-resident-row ${selected?.id === resident.id ? "selected" : ""}`}
                    type="button"
                    key={resident.id}
                    onClick={() => setSelectedId(resident.id)}
                  >
                    <span className={`resident-avatar ${avatarTone(resident)}`}>{resident.initials}</span>
                    <span className="house-resident-person">
                      <strong>
                        {resident.name} <ResuscitationBadge residentId={resident.id} />
                      </strong>
                      <small>
                        {resident.room ? (isArchived(resident) ? `Ehem. ${resident.room}` : resident.room) : "–"}
                      </small>
                    </span>
                    <span className="house-resident-unit">
                      <strong>{resident.careUnit || "–"}</strong>
                      <small>{resident.status === "Aktiv" ? "Aktueller Aufenthalt" : "Letzter Wohnbereich"}</small>
                    </span>
                    <span className="house-resident-period">
                      <strong>{periodOf(resident)}</strong>
                      <small>{isArchived(resident) ? "Historische Akte" : "Laufende Akte"}</small>
                    </span>
                    <span className="house-resident-last">
                      <strong>{resident.lastEntry?.title ?? "Noch keine Einträge"}</strong>
                      <small>
                        {resident.lastEntry
                          ? `${formatDateTime(resident.lastEntry.occurredAt)} · ${resident.lastEntry.author ?? "Unbekannt"}`
                          : "–"}
                      </small>
                    </span>
                    <span className={`resident-state ${resident.status.toLocaleLowerCase("de-CH")}`}>
                      {resident.status}
                    </span>
                    <ModuleIcon name="chevron" className="chevron" />
                  </button>
                ))}
                {!overview.loading && filteredResidents.length === 0 && (
                  <div className="resident-empty">
                    <ModuleIcon name="search" />
                    <strong>Keine {t.prefix}akten gefunden</strong>
                    <p>Suchbegriff, Wohnbereich oder Statusfilter anpassen.</p>
                    <button className="secondary-button" type="button" onClick={resetFilters}>
                      Filter zurücksetzen
                    </button>
                  </div>
                )}
              </div>
            </section>

            <aside className="house-history-sidebar">
              {selected && (
                <section className={`card house-resident-focus ${archived ? "archived" : ""}`} aria-live="polite">
                  <div className="card-header">
                    <div>
                      <p className="eyebrow">Ausgewählte {t.prefix}akte</p>
                      <h2 className="card-title">{selected.name}</h2>
                      <p className="card-subtitle">
                        {[selected.room, selected.careUnit].filter(Boolean).join(" · ") || "Ohne Zimmerzuteilung"}
                      </p>
                    </div>
                    <span className={`resident-state ${selected.status.toLocaleLowerCase("de-CH")}`}>
                      {selected.status}
                    </span>
                  </div>
                  <div className="house-resident-focus-body">
                    <span className={`resident-avatar ${avatarTone(selected)}`}>{selected.initials}</span>
                    <h3>{selected.lastEntry?.title ?? "Noch keine Einträge"}</h3>
                    <p>{selected.lastEntry?.body ?? "Für diese Akte wurde noch nichts dokumentiert."}</p>
                    <dl>
                      <div>
                        <dt>Aktenstatus</dt>
                        <dd>{selected.status}</dd>
                      </div>
                      <div>
                        <dt>Zeitraum</dt>
                        <dd>{periodOf(selected)}</dd>
                      </div>
                      <div>
                        <dt>Letzter Eintrag</dt>
                        <dd>{selected.lastEntry ? formatDateTime(selected.lastEntry.occurredAt) : "–"}</dd>
                      </div>
                      <div>
                        <dt>Erfasst von</dt>
                        <dd>{selected.lastEntry?.author ?? "–"}</dd>
                      </div>
                      <div>
                        <dt>Einträge gesamt</dt>
                        <dd>{selected.entryCount}</dd>
                      </div>
                    </dl>
                    {archived && (
                      <div className="archive-privacy-note">
                        <ModuleIcon name="quality" />
                        <span>
                          <strong>Geschützte Archivakte</strong>
                          <small>Nur für berechtigte Mitarbeitende sichtbar.</small>
                        </span>
                      </div>
                    )}
                    <div className="course-focus-actions">
                      <Link className="primary-button" href={`/bewohner?resident=${selected.id}`}>
                        {archived ? "Archivakte öffnen" : `${t.prefix}akte öffnen`}
                      </Link>
                      {canWrite && selected.status === "Aktiv" && (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => setDialog({ kind: "exit", resident: selected })}
                        >
                          Austritt erfassen
                        </button>
                      )}
                      {canWrite && selected.status === "Verlegt" && (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => setDialog({ kind: "return", resident: selected })}
                        >
                          Rückkehr erfassen
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {selected && (
                <section className="card house-timeline">
                  <div className="card-header">
                    <div>
                      <h2 className="card-title">Verlauf</h2>
                      <p className="card-subtitle">Aufenthalte und letzte Einträge</p>
                    </div>
                  </div>
                  {detail.error && <LoadError message={detail.error} onRetry={detail.reload} />}
                  <ol>
                    {(detail.data?.stays ?? []).map((stay) => (
                      <li key={stay.id} className="stay">
                        <strong>{[stay.careUnit, stay.room].filter(Boolean).join(" · ") || "Aufenthalt"}</strong>
                        <small>
                          {formatDate(stay.startedAt)} – {stay.endedAt ? formatDate(stay.endedAt) : "laufend"}
                        </small>
                      </li>
                    ))}
                    {(detail.data?.entries ?? []).map((entry) => (
                      <li key={entry.id} className={entry.importance === "critical" ? "critical" : ""}>
                        <strong>{entry.title}</strong>
                        <small>
                          {formatDateTime(entry.occurredAt)} · {entry.author ?? "Unbekannt"}
                        </small>
                        <p>{entry.body}</p>
                      </li>
                    ))}
                    {detail.data && !detail.data.stays.length && !detail.data.entries.length && (
                      <li className="empty">Noch kein Verlauf vorhanden.</li>
                    )}
                  </ol>
                </section>
              )}

              <section className="card house-status-overview">
                <div className="card-header">
                  <div>
                    <h2 className="card-title">Akten nach Status</h2>
                    <p className="card-subtitle">Gesamtes Haus</p>
                  </div>
                </div>
                <div>
                  {HISTORY_STATUSES.slice(1).map((item) => {
                    const total = count(item);
                    return (
                      <button type="button" key={item} onClick={() => setStatus(item)}>
                        <span
                          className={`priority-dot ${item === "Aktiv" ? "stable" : item === "Verlegt" || item === "Geplant" ? "info" : "archived"}`}
                        />
                        <span>
                          <strong>{item}</strong>
                          <small>
                            {total} {total === 1 ? "Akte" : "Akten"}
                          </small>
                        </span>
                        <ModuleIcon name="chevron" />
                      </button>
                    );
                  })}
                </div>
              </section>
            </aside>
          </div>
          {dialog && (
            <StayDialog
              mode={dialog}
              onClose={() => setDialog(null)}
              onSaved={(message) => {
                setDialog(null);
                showToast(message);
                overview.reload();
                detail.reload();
              }}
            />
          )}
        </main>
      )}
    </ModulePageShell>
  );
}
