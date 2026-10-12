"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setCareResident, useTerms } from "@/app/components/care-context";
import { ModuleIcon } from "@/app/components/module-icon";
import { LoadError, formatDate } from "@/app/components/workspace-ui";
import { RAI_STATE, type RaiResidentRow } from "@/lib/rai-shared";
import type { RaiData } from "./rai-data";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

const FILTERS = ["Alle", "Fällig", "In Bearbeitung", "Aktuell"];

export function nextLabel(row: RaiResidentRow) {
  if (!row.dueOn) return "offen";
  return formatDate(row.dueOn);
}

// Öffnet die Abklärung einer Person; die Person in der Kopfzeile folgt.
export function useOpenAssessment() {
  const router = useRouter();
  return (residentId: string) => {
    setCareResident(residentId);
    router.push(`/c/kompass/abklaerung?resident=${residentId}`);
  };
}

export function OverviewView({ rai }: { rai: RaiData }) {
  const t = useTerms();
  const router = useRouter();
  const openAssessment = useOpenAssessment();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Alle");
  const residents = useMemo(() => rai.data?.residents ?? [], [rai.data]);
  const filtered = useMemo(
    () =>
      residents.filter(
        (resident) =>
          (filter === "Alle" || RAI_STATE[resident.state].label === filter) &&
          `${resident.name} ${resident.room} ${resident.unit}`
            .toLocaleLowerCase("de-CH")
            .includes(query.trim().toLocaleLowerCase("de-CH")),
      ),
    [filter, query, residents],
  );
  if (rai.error && !rai.data) return <LoadError message={rai.error} onRetry={rai.reload} />;
  const summary = rai.data?.summary;
  const people = rai.data?.people ?? [];
  const next =
    residents.find((row) => row.state === "in_progress") ??
    residents.find((row) => row.state === "overdue") ??
    residents.find((row) => row.state === "due" || row.state === "new") ??
    null;
  return (
    <>
      <section className="rai-summary" aria-label="Kompass Übersicht">
        <div>
          <span className="rai-summary-icon">
            <ModuleIcon name="assess" />
          </span>
          <span>
            <strong>{summary?.records ?? "–"}</strong>
            <small>Personen mit Abklärung</small>
          </span>
        </div>
        <div>
          <span className="rai-summary-icon attention">
            <ModuleIcon name="calendar" />
          </span>
          <span>
            <strong>{summary?.due ?? "–"}</strong>
            <small>Abklärungen fällig</small>
          </span>
        </div>
        <div>
          <span className="rai-summary-icon info">
            <ModuleIcon name="check" />
          </span>
          <span>
            <strong>{summary ? `${summary.currentShare}%` : "–"}</strong>
            <small>hausweit aktuell</small>
          </span>
        </div>
        <div>
          <span className="rai-summary-icon stable">
            <ModuleIcon name="team" />
          </span>
          <span>
            <strong>{summary?.responsible ?? "–"}</strong>
            <small>Verantwortliche</small>
          </span>
        </div>
      </section>
      <div className="rai-overview-layout">
        <section className="card rai-worklist">
          <div className="rai-card-header">
            <div>
              <p className="eyebrow">Arbeitskorb</p>
              <h2 className="card-title">{t.many} und Abklärungen</h2>
              <p className="card-subtitle">
                {rai.loading && !rai.data
                  ? "Wird geladen …"
                  : `${filtered.length} von ${residents.length} Einträgen sichtbar`}
              </p>
            </div>
            <label className="resident-search">
              <ModuleIcon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`${t.many} suchen`}
                aria-label={`${t.many} im Kompass suchen`}
              />
            </label>
          </div>
          <div className="rai-filter-row">
            {FILTERS.map((item) => (
              <button
                className={filter === item ? "active" : ""}
                type="button"
                key={item}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="rai-resident-list">
            {filtered.map((resident) => (
              <button
                type="button"
                className="rai-resident-row"
                key={resident.id}
                onClick={() => openAssessment(resident.id)}
              >
                <span className="resident-avatar">{resident.initials}</span>
                <span>
                  <strong>
                    {resident.name} <ResuscitationBadge residentId={resident.id} />
                  </strong>
                  <small>
                    {resident.room} · {resident.unit}
                  </small>
                  <em>
                    {resident.assessor ?? "Noch nicht zugewiesen"} · {resident.reason} · fällig {nextLabel(resident)}
                  </em>
                </span>
                <span className="rai-progress">
                  <i>
                    <span style={{ width: `${resident.progress}%` }} />
                  </i>
                  <b>{resident.progress}%</b>
                </span>
                <span className={`status-badge ${RAI_STATE[resident.state].tone}`}>
                  {RAI_STATE[resident.state].label}
                </span>
                <ModuleIcon name="chevron" />
              </button>
            ))}
            {rai.data && filtered.length === 0 && (
              <div className="resident-empty">
                <ModuleIcon name="search" />
                <strong>Keine Personen gefunden</strong>
                <p>Suchbegriff oder Filter anpassen.</p>
              </div>
            )}
          </div>
        </section>
        <aside className="rai-side-stack">
          <section className="card rai-responsible-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Rollen und Rechte</p>
                <h2 className="card-title">Verantwortliche</h2>
              </div>
              <span className="status-badge stable">{people.length} aktiv</span>
            </div>
            <div className="rai-responsible-list">
              {people.map((person) => (
                <div key={person.id}>
                  <span className="avatar">{person.initials}</span>
                  <span>
                    <strong>{person.name}</strong>
                    <small>
                      {person.openAssessments
                        ? `${person.openAssessments} offene Abklärung${person.openAssessments === 1 ? "" : "en"}`
                        : "keine offenen Abklärungen"}
                    </small>
                  </span>
                  {person.online && <span className="rai-online-dot" title="Gerade aktiv" />}
                </div>
              ))}
              {rai.data && !people.length && (
                <p className="card-subtitle">Noch niemand mit Berechtigung für den Kompass.</p>
              )}
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => router.push("/c/leitung/administration/mitarbeiter")}
            >
              Berechtigungen verwalten <ModuleIcon name="chevron" />
            </button>
          </section>
          <section className="card rai-next-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Nächster Schritt</p>
                <h2 className="card-title">
                  {next?.state === "in_progress" ? "Abklärung fortsetzen" : "Nächste Abklärung"}
                </h2>
              </div>
            </div>
            <span className="rai-next-icon">
              <ModuleIcon name="assess" />
            </span>
            {next ? (
              <>
                <strong>
                  {next.name} · {next.reason}
                </strong>
                <p>
                  {next.state === "in_progress"
                    ? `Die Abklärung ist zu ${next.progress}% erledigt. Die offenen Bereiche warten auf deine fachliche Einschätzung.`
                    : `${next.reason} · fällig ${nextLabel(next)}.`}
                </p>
                <button className="primary-button" type="button" onClick={() => openAssessment(next.id)}>
                  {next.state === "in_progress" ? "Weiterarbeiten" : "Abklärung beginnen"} <ModuleIcon name="chevron" />
                </button>
              </>
            ) : (
              <>
                <strong>Alles aktuell</strong>
                <p>{rai.data ? "Keine Abklärung ist offen oder fällig." : "Wird geladen …"}</p>
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
