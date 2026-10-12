"use client";

import { useTerms } from "@/app/components/care-context";
import { useState, type KeyboardEvent } from "react";
import { Icon } from "./residents-utils";
import type { ResidentsPageState } from "./use-residents-page";

// Schnellsuche (Strg/⌘ + K): alle Bewohner unabhängig vom Filter des Verzeichnisses; Pfeiltasten wählen,
// Enter öffnet die Akte.
export function ResidentSearchDialog({ r }: { r: ResidentsPageState }) {
  const t = useTerms();
  const { residents, setSearchOpen, setSelectedResident } = r;
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const needle = term.trim().toLocaleLowerCase("de-CH");
  const results = residents.filter((resident) =>
    `${resident.name} ${resident.room} ${resident.unit} ${resident.note}`.toLocaleLowerCase("de-CH").includes(needle),
  );
  const current = Math.min(active, Math.max(results.length - 1, 0));
  const open = (index: number) => {
    const resident = results[index];
    if (!resident) return;
    setSearchOpen(false);
    setSelectedResident(resident);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setActive((current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(current);
    }
  };
  return (
    <section
      id="resident-global-search"
      className="search-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={`${t.many} suchen`}
    >
      <div className="search-input-wrap">
        <Icon name="search" />
        <input
          autoFocus
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={`${t.many} nach Name, Zimmer oder Wohnbereich suchen…`}
          aria-label="Suchbegriff"
          aria-controls="resident-search-results"
          aria-activedescendant={results.length ? `resident-search-${current}` : undefined}
        />
        <button type="button" onClick={() => setSearchOpen(false)} aria-label="Suche schliessen">
          ESC
        </button>
      </div>
      <div className="search-results" id="resident-search-results" role="listbox" aria-label={t.many}>
        <span className="search-group-label">
          {t.many} · {results.length} von {residents.length}
        </span>
        {results.map((resident, index) => (
          <button
            className={`search-result${index === current ? " active" : ""}`}
            type="button"
            role="option"
            id={`resident-search-${index}`}
            aria-selected={index === current}
            key={resident.id ?? resident.name}
            onMouseEnter={() => setActive(index)}
            onClick={() => open(index)}
          >
            <span className="result-icon">
              <Icon name="residents" />
            </span>
            <span>
              <strong>{resident.name}</strong>
              <small>{[resident.room, resident.unit].filter(Boolean).join(" · ") || "Ohne Zimmer"}</small>
            </span>
          </button>
        ))}
        {!results.length && (
          <p className="search-empty">
            {residents.length
              ? `Keine ${t.many} zu „${term.trim()}“ gefunden.`
              : `Es sind noch keine ${t.many} erfasst.`}
          </p>
        )}
      </div>
    </section>
  );
}
