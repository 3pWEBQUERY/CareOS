"use client";

import { useResidentNavigation, useTerms } from "./care-context";
import { ModuleIcon } from "./module-icon";
import type { AppHeaderState } from "./use-app-header";

export function HeaderResidentSelector({ r, compact = false }: { r: AppHeaderState; compact?: boolean }) {
  const { residentOpen, setResidentOpen, selectedResident, closeMenus } = r;
  const navigation = useResidentNavigation();
  const t = useTerms();
  return (
    <div className={`resident-context-wrap ${compact ? "mobile-resident-context-wrap" : ""}`}>
      <button
        className={`resident-context-trigger ${compact ? "mobile-resident-context-trigger" : ""} ${residentOpen ? "open" : ""}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={residentOpen}
        aria-label={compact ? `${t.oneOblique} auswählen` : undefined}
        onClick={() => {
          closeMenus();
          setResidentOpen(true);
        }}
      >
        <span className={`resident-context-avatar ${selectedResident?.tone ?? ""}`}>
          {selectedResident?.initials ?? "…"}
        </span>
        {!compact && (
          <span className="resident-context-copy">
            <small>{t.one}</small>
            <strong>{selectedResident?.name ?? `${t.oneOblique} auswählen`}</strong>
          </span>
        )}
        <ModuleIcon name="chevron" className="chevron" />
      </button>
      {!compact && navigation.total > 1 && (
        <span className="resident-context-nav" aria-label={`Zwischen ${t.manyDative} blättern`}>
          <button
            type="button"
            aria-label={`Vorheriger ${t.one}`}
            title={`Vorheriger ${t.one}`}
            onClick={navigation.previous}
          >
            <ModuleIcon name="chevron" className="up" />
          </button>
          <small>
            {navigation.position} / {navigation.total}
          </small>
          <button type="button" aria-label={`Nächster ${t.one}`} title={`Nächster ${t.one}`} onClick={navigation.next}>
            <ModuleIcon name="chevron" className="down" />
          </button>
        </span>
      )}
    </div>
  );
}
