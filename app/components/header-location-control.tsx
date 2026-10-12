"use client";

import Image from "next/image";
import { type RefObject } from "react";
import { ModuleIcon } from "./module-icon";
import type { AppHeaderState } from "./use-app-header";
import { useBranding } from "./care-context";

export function HeaderLocationControl({
  r,
  ref,
  compact = false,
}: {
  r: AppHeaderState;
  ref: RefObject<HTMLDivElement | null>;
  compact?: boolean;
}) {
  const {
    locationPrimary,
    locationSecondary,
    context,
    locationOpen,
    setLocationOpen,
    selectedAreaId,
    setResidentOpen,
    selectedArea,
    closeMenus,
    chooseArea,
  } = r;
  const branding = useBranding();
  return (
    <div className={`location-menu-wrap ${compact ? "mobile-location-menu-wrap" : ""}`} ref={ref}>
      <button
        className={`location-control ${compact ? "mobile-location-control" : ""} ${locationOpen ? "open" : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={locationOpen}
        aria-label={compact ? "Wohnbereich auswählen" : undefined}
        onClick={() => {
          setResidentOpen(false);
          closeMenus();
          setLocationOpen((value) => !value);
        }}
      >
        <span className={`location-icon ${branding?.logoUpdatedAt ? "has-logo" : ""}`}>
          {branding?.logoUpdatedAt ? (
            <Image
              src={`/api/branding/logo?v=${encodeURIComponent(branding.logoUpdatedAt)}`}
              alt={`Logo ${branding.organizationName}`}
              width={33}
              height={33}
              loading="eager"
              unoptimized
            />
          ) : (
            branding && <ModuleIcon name="building" />
          )}
        </span>
        {!compact && (
          <span className="location-copy">
            <small>{branding?.organizationName ?? locationPrimary}</small>
            <strong>
              {selectedArea ? `${selectedArea.name} · ${selectedArea.detail.split(" · ")[0]}` : locationSecondary}
            </strong>
          </span>
        )}
        <ModuleIcon name="chevron" className="chevron" />
      </button>
      {locationOpen && (
        <div
          className={`location-dropdown ${compact ? "mobile-location-dropdown" : ""}`}
          role="menu"
          aria-label="Wohnbereich auswählen"
        >
          <div className="context-dropdown-header">
            <div>
              <p className="eyebrow">Arbeitsbereich</p>
              <strong>Wohnbereich wechseln</strong>
            </div>
            <span>
              {context?.profile.primaryCareUnitName ? `Fest: ${context.profile.primaryCareUnitName}` : locationPrimary}
            </span>
          </div>
          <div className="location-options">
            {context?.careUnits.map((area) => (
              <button
                className={`location-option ${area.id === selectedAreaId ? "active" : ""}`}
                type="button"
                role="menuitem"
                key={area.id}
                onClick={() => chooseArea(area)}
              >
                <span className="location-option-icon">
                  <ModuleIcon name="building" />
                </span>
                <span className="location-option-copy">
                  <strong>{area.name}</strong>
                  <small>
                    {area.detail}
                    {area.primary ? " · Fester Bereich" : ""}
                  </small>
                </span>
                <span className="location-option-count">{area.residentCount}</span>
                {area.id === selectedAreaId && <ModuleIcon name="check" className="location-option-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
