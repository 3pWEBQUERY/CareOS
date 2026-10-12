"use client";

import { useState } from "react";
import { ModuleIcon } from "./module-icon";
import type { ContextResident, WorkContext } from "@/lib/work-context";
import { countOf, termsFor } from "@/lib/terminology";

export function ResidentPickerPopover({
  context,
  selectedAreaId,
  selectedResident,
  onClose,
  onChoose,
}: {
  context: WorkContext;
  selectedAreaId: string | null;
  selectedResident: ContextResident | null;
  onClose: () => void;
  onChoose: (resident: ContextResident) => void;
}) {
  const [query, setQuery] = useState("");
  const t = termsFor(context.terminology);
  const [unitFilter, setUnitFilter] = useState(selectedAreaId ?? "all");
  const visibleResidents = context.residents.filter(
    (resident) =>
      (unitFilter === "all" || resident.careUnitId === unitFilter) &&
      `${resident.name} ${resident.room} ${resident.group}`
        .toLocaleLowerCase("de-CH")
        .includes(query.trim().toLocaleLowerCase("de-CH")),
  );
  return (
    <div
      className="resident-picker-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className="resident-picker-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resident-picker-title"
      >
        <header className="resident-picker-header">
          <div>
            <p className="eyebrow">{t.prefix}akte · Arbeitskontext</p>
            <h2 id="resident-picker-title">{t.oneOblique} auswählen</h2>
            <p>Standardmässig ist dein fester Wohnbereich ausgewählt. Du kannst bereichsübergreifend arbeiten.</p>
          </div>
          <button
            className="profile-panel-close"
            type="button"
            onClick={onClose}
            aria-label={`${t.prefix}auswahl schliessen`}
          >
            <ModuleIcon name="close" />
          </button>
        </header>
        <div className="resident-picker-body">
          <div className="resident-picker-toolbar">
            <label className="resident-picker-search">
              <ModuleIcon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
                placeholder="Name, Zimmer oder Wohnbereich suchen …"
                aria-label={`${t.oneOblique} suchen`}
              />
            </label>
            <span>{countOf(visibleResidents.length, t)} sichtbar</span>
          </div>
          <div className="resident-picker-filters" aria-label="Wohnbereich filtern">
            <button type="button" className={unitFilter === "all" ? "active" : ""} onClick={() => setUnitFilter("all")}>
              Alle Wohnbereiche
            </button>
            {context.careUnits.map((unit) => (
              <button
                type="button"
                className={unitFilter === unit.id ? "active" : ""}
                key={unit.id}
                onClick={() => setUnitFilter(unit.id)}
              >
                {unit.name}
                {unit.primary && <small>Fester Bereich</small>}
              </button>
            ))}
          </div>
          <div className="resident-picker-list">
            {visibleResidents.map((resident) => (
              <button
                className={resident.id === selectedResident?.id ? "active" : ""}
                type="button"
                key={resident.id}
                onClick={() => onChoose(resident)}
              >
                <span className={`resident-context-avatar ${resident.tone}`}>{resident.initials}</span>
                <span>
                  <strong>{resident.name}</strong>
                  <small>
                    {resident.room} · {resident.group}
                  </small>
                </span>
                <span className={`status-badge ${resident.tone}`}>{resident.status}</span>
                {resident.id === selectedResident?.id && <ModuleIcon name="check" />}
                <ModuleIcon name="chevron" />
              </button>
            ))}
            {visibleResidents.length === 0 && (
              <div className="resident-context-empty">
                <ModuleIcon name="search" />
                <strong>Keine {t.many} gefunden</strong>
                <span>Prüfe Suchbegriff oder Wohnbereich.</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
