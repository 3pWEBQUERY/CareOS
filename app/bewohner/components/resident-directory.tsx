"use client";

import { useTerms } from "@/app/components/care-context";
import { countOf } from "@/lib/terminology";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";
import { Icon, residentStatusFilters, ResidentAvatar } from "./residents-utils";
import type { ResidentsPageState } from "./use-residents-page";

export function ResidentDirectory({ r }: { r: ResidentsPageState }) {
  const t = useTerms();
  const {
    query,
    setQuery,
    units,
    unit,
    setUnit,
    statusFilter,
    setStatusFilter,
    filtersOpen,
    setFiltersOpen,
    setSelectedResident,
    filteredResidents,
    residents,
    ownUnit,
  } = r;
  const filtered = unit !== "Alle" || statusFilter !== "Alle" || Boolean(query);
  const activeFilters = Number(unit !== "Alle") + Number(statusFilter !== "Alle");
  const resetFilters = () => {
    setUnit("Alle");
    setStatusFilter("Alle");
    setQuery("");
  };
  return (
    <section className="card resident-directory" aria-labelledby="directory-title">
      <div className="directory-toolbar">
        <div>
          <h2 className="card-title" id="directory-title">
            {t.prefix}verzeichnis
          </h2>
          <p className="card-subtitle">
            {filtered
              ? `${filteredResidents.length} von ${residents.length} ${t.manyDative}${unit !== "Alle" ? ` · ${unit}` : ""}${statusFilter !== "Alle" ? ` · ${statusFilter}` : ""}`
              : `${countOf(residents.length, t)} aus der Datenbank`}
          </p>
        </div>
        <label className="resident-search">
          <Icon name="search" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name oder Zimmer suchen"
            aria-label={`${t.many} suchen`}
          />
        </label>
        <button
          className={`secondary-button directory-filter ${filtersOpen ? "active" : ""}`}
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="resident-filter-panel"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <Icon name="filter" />
          {filtersOpen ? "Filter schliessen" : activeFilters ? `Filter (${activeFilters})` : "Filter"}
          <Icon name="caretDown" className="directory-filter-caret" />
        </button>
      </div>
      <div
        id="resident-filter-panel"
        className={`resident-filter-panel ${filtersOpen ? "open" : ""}`}
        aria-hidden={!filtersOpen}
      >
        <div className="resident-filter-panel-inner" inert={!filtersOpen}>
          <div className="resident-filter-group">
            <span>Wohnbereich</span>
            <div className="unit-filter" aria-label="Wohnbereich filtern">
              {[
                "Alle",
                ...(ownUnit && units.includes(ownUnit)
                  ? [ownUnit, ...units.filter((item) => item !== ownUnit)]
                  : units),
              ].map((label) => (
                <button
                  className={unit === label ? "active" : ""}
                  type="button"
                  aria-pressed={unit === label}
                  key={label}
                  onClick={() => setUnit(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="resident-filter-group">
            <span>{t.prefix}status</span>
            <div className="resident-status-filter" aria-label={`${t.prefix}status filtern`}>
              {residentStatusFilters.map((label) => (
                <button
                  className={statusFilter === label ? "active" : ""}
                  type="button"
                  aria-pressed={statusFilter === label}
                  key={label}
                  onClick={() => setStatusFilter(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {filtered && (
            <button className="resident-filter-reset" type="button" onClick={resetFilters}>
              Filter zurücksetzen
            </button>
          )}
        </div>
      </div>

      <div className="resident-table" role="table" aria-label={`${t.prefix}liste`}>
        <div className="resident-table-head" role="row">
          <span role="columnheader">{t.one}</span>
          <span role="columnheader">Wohnbereich</span>
          <span role="columnheader">Pflegebedarf</span>
          <span role="columnheader">Letzte Aktualisierung</span>
          <span role="columnheader">Status</span>
          <span aria-hidden="true" />
        </div>
        {filteredResidents.map((resident) => (
          <button
            className="resident-list-row"
            type="button"
            role="row"
            key={resident.id ?? resident.name}
            onClick={() => setSelectedResident(resident)}
          >
            <span className="resident-person" role="cell">
              <ResidentAvatar resident={resident} />
              <span>
                <span className="rea-name">
                  <strong>{resident.name}</strong>
                  <ResuscitationBadge residentId={resident.id} />
                </span>
                <small>{resident.room}</small>
              </span>
            </span>
            <span role="cell">
              {resident.unit}
              {ownUnit && resident.unit === ownUnit && <small className="resident-own-unit">Meine Wohngruppe</small>}
            </span>
            <span role="cell">
              <strong>{resident.careLevel}</strong>
              <small>{resident.note}</small>
            </span>
            <span role="cell">{resident.lastUpdate}</span>
            <span role="cell">
              <span className={`status-badge ${resident.status}`}>{resident.statusLabel}</span>
            </span>
            <span role="cell">
              <Icon name="chevron" />
            </span>
          </button>
        ))}
        {filteredResidents.length === 0 && (
          <div className="resident-empty">
            <Icon name="search" />
            <strong>Keine {t.many} gefunden</strong>
            <p>
              {residents.length
                ? `Keine ${t.many} passen zu Suche und Filter.`
                : `Es sind noch keine ${t.many} erfasst. Über „${t.oneOblique} aufnehmen“ legst du die erste Akte an.`}
            </p>
            {filtered && residents.length > 0 && (
              <button className="secondary-button" type="button" onClick={resetFilters}>
                Alle {countOf(residents.length, t)} anzeigen
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
