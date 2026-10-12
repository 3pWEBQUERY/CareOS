"use client";

import { Fragment, useEffect, useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { EmptyState, LoadError } from "@/app/components/workspace-ui";
import {
  SERVICES,
  SITE_STATUS,
  unitPlaces,
  type OrganizationStructure,
  type OrgSite,
  type OrgUnit,
} from "@/lib/organization-shared";
import type { Tone } from "./leadership-data";
import { notifyAdminChanged } from "./admin-board";
import { LocationEditor } from "./location-editor";
import { UnitEditor } from "./unit-editor";
import { onSetupStep, SetupChecklistCard } from "./setup-checklist-card";

export type OrganizationData = {
  data?: OrganizationStructure;
  error?: string;
  loading: boolean;
  reload: () => void;
};

function unitState(unit: OrgUnit): { label: string; tone: Tone } {
  const places = unitPlaces(unit);
  if (!unit.active) return { label: "Inaktiv", tone: "info" };
  if (!unit.leadId) return { label: "Leitung fehlt", tone: "attention" };
  if (places && unit.occupied > places) return { label: "Überbelegt", tone: "critical" };
  if (places && unit.occupied >= places) return { label: "Voll belegt", tone: "info" };
  return { label: "Stabil", tone: "stable" };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// "Leitung · Organisation": sites with their care units, occupancy, leads and staff.
export function OrganizationView({
  organization,
  showToast,
  siteCreatorOpen,
  onCloseSiteCreator,
}: {
  organization: OrganizationData;
  showToast: (message: string) => void;
  siteCreatorOpen: boolean;
  onCloseSiteCreator: () => void;
}) {
  const { data, error, reload } = organization;
  const [selection, setSelection] = useState<{ kind: "site" | "unit"; id: string } | null>(null);
  const [unitEditor, setUnitEditor] = useState<{ unit: OrgUnit | null } | null>(null);
  const [siteEditor, setSiteEditor] = useState<OrgSite | null>(null);

  // Ersteinrichtung („Öffnen“ bzw. Adresse mit #standort / #wohnbereich): passenden Dialog direkt öffnen.
  const sites = data?.sites;
  useEffect(() => {
    if (!sites) return;
    const open = (anchor: string) => {
      if (anchor === "standort" && sites.length)
        setSiteEditor(sites.find((site) => !site.addressLine1 || !site.city) ?? sites[0]);
      if (anchor === "wohnbereich") setUnitEditor({ unit: null });
    };
    const fromAddress = window.location.hash.slice(1);
    if (fromAddress) {
      const initial = window.setTimeout(() => open(fromAddress), 0);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      const stop = onSetupStep(open);
      return () => {
        window.clearTimeout(initial);
        stop();
      };
    }
    return onSetupStep(open);
  }, [sites]);

  if (error && !data) return <LoadError message={error} onRetry={reload} />;
  if (!data)
    return (
      <div className="admin-organization-layout">
        <section className="card organization-map">
          <div className="card-header">
            <div>
              <p className="eyebrow">Standortstruktur</p>
              <h2 className="card-title">Wird geladen …</h2>
            </div>
          </div>
        </section>
      </div>
    );

  const single = data.sites.length === 1;
  const selectedSite = selection?.kind === "site" ? data.sites.find((site) => site.id === selection.id) : undefined;
  const selectedUnit =
    selection?.kind === "unit"
      ? data.units.find((unit) => unit.id === selection.id)
      : selectedSite
        ? undefined
        : data.units[0];
  const siteUnits = (site: OrgSite) => data.units.filter((unit) => unit.siteId === site.id);
  const siteTotals = (site: OrgSite) => {
    const units = siteUnits(site).filter((unit) => unit.active);
    return {
      places: units.reduce((sum, unit) => sum + unitPlaces(unit), 0),
      occupied: units.reduce((sum, unit) => sum + unit.occupied, 0),
    };
  };

  const detail = selectedSite
    ? (() => {
        const totals = siteTotals(selectedSite);
        return {
          eyebrow: "Standortprofil",
          title: selectedSite.name,
          badge: {
            label: SITE_STATUS[selectedSite.status],
            tone: selectedSite.status === "active" ? "stable" : "info",
          },
          occupied: totals.occupied,
          places: totals.places,
          text: [
            [selectedSite.siteType, selectedSite.country].filter(Boolean).join(" · "),
            [selectedSite.addressLine1, [selectedSite.postalCode, selectedSite.city].filter(Boolean).join(" ")]
              .filter(Boolean)
              .join(", "),
            plural(siteUnits(selectedSite).length, "Wohnbereich", "Wohnbereiche"),
            selectedSite.managerName ? `Leitung ${selectedSite.managerName}` : "Leitung noch nicht festgelegt",
            selectedSite.notes,
          ]
            .filter(Boolean)
            .join(" · "),
          edit: () => setSiteEditor(selectedSite),
        };
      })()
    : selectedUnit
      ? {
          eyebrow: "Bereichsprofil",
          title: selectedUnit.name,
          badge: selectedUnit.active
            ? { label: "Aktiv", tone: "stable" as Tone }
            : { label: "Inaktiv", tone: "info" as Tone },
          occupied: selectedUnit.occupied,
          places: unitPlaces(selectedUnit),
          text: [
            [selectedUnit.floor, selectedUnit.code].filter(Boolean).join(" · "),
            `${plural(selectedUnit.rooms, "Zimmer", "Zimmer")} mit ${plural(selectedUnit.beds, "Bett", "Betten")}`,
            `${selectedUnit.staff} Mitarbeitende`,
            selectedUnit.leadName ? `Leitung ${selectedUnit.leadName}` : "Leitung noch nicht festgelegt",
            selectedUnit.services.length
              ? selectedUnit.services.map((service) => SERVICES[service]).join(", ")
              : "keine Dienste geplant",
            selectedUnit.notes,
          ]
            .filter(Boolean)
            .join(" · "),
          edit: () => setUnitEditor({ unit: selectedUnit }),
        }
      : null;
  const share = detail && detail.places ? Math.min(100, Math.round((detail.occupied / detail.places) * 100)) : 0;
  const header = single ? data.sites[0].name : data.organization.name;

  return (
    <>
      <SetupChecklistCard showToast={showToast} />
      <div className="admin-organization-layout">
        <section className="card organization-map">
          <div className="card-header">
            <div>
              <p className="eyebrow">Standortstruktur</p>
              <h2 className="card-title">{header}</h2>
              <p className="card-subtitle">
                {plural(data.totals.units, "Wohnbereich", "Wohnbereiche")} ·{" "}
                {plural(data.totals.places, "Platz", "Plätze")}
              </p>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => setUnitEditor({ unit: null })}
              disabled={!data.sites.some((site) => site.status !== "archived")}
            >
              <ModuleIcon name="plus" /> Wohnbereich
            </button>
          </div>
          <div className="organization-tree">
            {!data.sites.length && (
              <EmptyState icon="building" title="Noch kein Standort" text="Lege zuerst einen Standort an." />
            )}
            {data.sites.map((site) => {
              const totals = siteTotals(site);
              return (
                <Fragment key={site.id}>
                  <div
                    className={`organization-root ${selectedSite?.id === site.id ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    title="Standortprofil anzeigen"
                    onClick={() => setSelection({ kind: "site", id: site.id })}
                    onKeyDown={(event) =>
                      (event.key === "Enter" || event.key === " ") && setSelection({ kind: "site", id: site.id })
                    }
                  >
                    <ModuleIcon name="building" />
                    <span>
                      <strong>{single ? "Gesamtes Haus" : site.name}</strong>
                      <small>
                        {totals.occupied} {totals.occupied === 1 ? "Platz" : "Plätze"} belegt ·{" "}
                        {`${single ? data.totals.staff : site.staff} Mitarbeitende`}
                        {site.status !== "active" ? ` · ${SITE_STATUS[site.status]}` : ""}
                      </small>
                    </span>
                  </div>
                  {siteUnits(site).map((unit) => {
                    const state = unitState(unit);
                    return (
                      <button
                        className={selectedUnit?.id === unit.id ? "selected" : ""}
                        type="button"
                        key={unit.id}
                        onClick={() => setSelection({ kind: "unit", id: unit.id })}
                      >
                        <span className={`governance-icon ${state.tone}`}>
                          <ModuleIcon name="building" />
                        </span>
                        <span>
                          <strong>
                            {unit.name}
                            {unit.floor ? ` · ${unit.floor}` : ""}
                          </strong>
                          <small>
                            {plural(unitPlaces(unit), "Platz", "Plätze")} · {unit.occupied} belegt ·{" "}
                            {unit.leadName ? `Team ${unit.leadName}` : "ohne Leitung"}
                          </small>
                        </span>
                        <span className={`status-badge ${state.tone}`}>{state.label}</span>
                        <ModuleIcon name="chevron" />
                      </button>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </section>
        {detail && (
          <aside className="card organization-detail">
            <div className="card-header">
              <div>
                <p className="eyebrow">{detail.eyebrow}</p>
                <h2 className="card-title">{detail.title}</h2>
              </div>
              <span className={`status-badge ${detail.badge.tone}`}>{detail.badge.label}</span>
            </div>
            <div className="organization-capacity">
              <strong>
                {detail.occupied} / {detail.places}
              </strong>
              <span>Plätze belegt</span>
              <div>
                <span style={{ width: `${share}%` }} />
              </div>
            </div>
            <p>{detail.text}</p>
            <button className="secondary-button" type="button" onClick={detail.edit}>
              Details bearbeiten <ModuleIcon name="chevron" />
            </button>
          </aside>
        )}
      </div>
      {unitEditor && (
        <UnitEditor
          unit={unitEditor.unit}
          data={data}
          onClose={() => setUnitEditor(null)}
          onSaved={(id) => {
            setSelection({ kind: "unit", id });
            reload();
            notifyAdminChanged();
          }}
          showToast={showToast}
        />
      )}
      {(siteEditor || siteCreatorOpen) && (
        <LocationEditor
          site={siteEditor}
          people={data.people}
          onClose={() => {
            setSiteEditor(null);
            onCloseSiteCreator();
          }}
          onSaved={() => {
            reload();
            notifyAdminChanged();
          }}
          showToast={showToast}
        />
      )}
    </>
  );
}
