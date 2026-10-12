"use client";

import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { requestJson } from "@/app/components/workspace-ui";
import { FLOORS, SERVICES, type OrganizationStructure, type OrgUnit, type ServiceKey } from "@/lib/organization-shared";
import { AreaSelect } from "./leadership-variant-parts";

const NONE = "";

// Creates a care unit, or edits `unit`. Rendered only while open so the form starts from the unit.
export function UnitEditor({
  unit,
  data,
  onClose,
  onSaved,
  showToast,
}: {
  unit: OrgUnit | null;
  data: OrganizationStructure;
  onClose: () => void;
  onSaved: (id: string) => void;
  showToast: (message: string) => void;
}) {
  const sites = data.sites.filter((site) => site.status !== "archived" || site.id === unit?.siteId);
  const [siteId, setSiteId] = useState(unit?.siteId ?? sites[0]?.id ?? "");
  const [areaName, setAreaName] = useState(unit?.name ?? "");
  const [areaCode, setAreaCode] = useState(unit?.code ?? "");
  const [areaCapacity, setAreaCapacity] = useState(unit ? String(unit.capacity ?? "") : "12");
  const [areaFloor, setAreaFloor] = useState(unit?.floor || "1. OG");
  const [leadId, setLeadId] = useState(unit?.leadId ?? NONE);
  const [services, setServices] = useState<ServiceKey[]>(unit?.services ?? ["early", "late"]);
  const [notes, setNotes] = useState(unit?.notes ?? "");
  const [active, setActive] = useState(unit?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const floors = FLOORS.includes(areaFloor) ? FLOORS : [...FLOORS, areaFloor];
  const personName = (id: string) =>
    id === NONE ? "Noch nicht festgelegt" : (data.people.find((person) => person.id === id)?.name ?? "Unbekannt");
  const toggleService = (service: ServiceKey) =>
    setServices((current) =>
      current.includes(service) ? current.filter((item) => item !== service) : [...current, service],
    );

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await requestJson<{ id: string }>(
        unit ? `/api/organization/units/${unit.id}` : "/api/organization/units",
        {
          method: unit ? "PATCH" : "POST",
          body: {
            siteId,
            name: areaName,
            code: areaCode,
            floor: areaFloor,
            capacity: areaCapacity,
            specialty: unit?.specialty ?? "",
            leadId: leadId || null,
            services,
            notes,
            active,
          },
        },
      );
      onSaved(result.id);
      onClose();
      showToast(unit ? `${areaName} wurde gespeichert` : `${areaName} wurde angelegt`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section className="area-editor-panel" role="dialog" aria-modal="true" aria-labelledby="area-editor-title">
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">Administration · Organisation</p>
            <h2 id="area-editor-title">{unit ? "Wohnbereich bearbeiten" : "Wohnbereich erstellen"}</h2>
            <p>
              {unit
                ? "Passe die Stammdaten, Leitung und Dienste des Bereichs an."
                : "Lege einen neuen Bereich an und definiere direkt die wichtigsten Stammdaten."}
            </p>
          </div>
          <button className="area-editor-close" type="button" onClick={onClose} aria-label="Bereichseditor schliessen">
            ×
          </button>
        </header>
        <form
          className="area-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="area-editor-intro">
            <span className="area-editor-icon">
              <ModuleIcon name="building" />
            </span>
            <div>
              <strong>{unit ? unit.name : "Neuer Wohnbereich"}</strong>
              <p>
                {unit
                  ? `${unit.occupied} Bewohnende · ${unit.rooms} Zimmer · ${unit.staff} Mitarbeitende`
                  : "Alle Angaben können später in der Organisation bearbeitet werden."}
              </p>
            </div>
          </div>
          <div className="area-editor-grid">
            <label>
              Bezeichnung
              <input
                value={areaName}
                onChange={(event) => setAreaName(event.target.value)}
                placeholder="z. B. Wohnbereich 4"
                maxLength={160}
                required
              />
            </label>
            <label>
              Kürzel
              <input
                value={areaCode}
                onChange={(event) => setAreaCode(event.target.value.toUpperCase())}
                placeholder="z. B. WB4"
                maxLength={5}
              />
            </label>
            <label>
              Etage
              <AreaSelect label="Etage" value={areaFloor} options={floors} onChange={setAreaFloor} />
            </label>
            <label>
              Kapazität
              <input
                type="number"
                min="0"
                max="500"
                value={areaCapacity}
                onChange={(event) => setAreaCapacity(event.target.value)}
                required
              />
            </label>
            {sites.length > 1 && (
              <label className="area-editor-wide">
                Standort
                <AreaSelect
                  label="Standort"
                  value={siteId}
                  options={sites.map((site) => site.id)}
                  onChange={setSiteId}
                  format={(id) => sites.find((site) => site.id === id)?.name ?? "–"}
                />
              </label>
            )}
            <label className="area-editor-wide">
              Verantwortliche Leitung
              <AreaSelect
                label="Verantwortliche Leitung"
                value={leadId}
                options={[NONE, ...data.people.map((person) => person.id)]}
                onChange={setLeadId}
                format={personName}
              />
            </label>
            <fieldset className="area-editor-wide">
              <legend>Geplante Dienste</legend>
              <div className="area-service-options">
                {(Object.keys(SERVICES) as ServiceKey[]).map((service) => (
                  <label key={service}>
                    <input
                      type="checkbox"
                      checked={services.includes(service)}
                      onChange={() => toggleService(service)}
                    />
                    <span>{SERVICES[service]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {unit && (
              <fieldset className="area-editor-wide">
                <legend>Status</legend>
                <div className="area-service-options">
                  <label>
                    <input type="checkbox" checked={active} onChange={() => setActive((value) => !value)} />
                    <span>Bereich aktiv</span>
                  </label>
                </div>
              </fieldset>
            )}
            <label className="area-editor-wide">
              Hinweis oder Zweck
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="z. B. Schwerpunkt Demenzpflege, Kurzzeitpflege …"
                rows={4}
                maxLength={2000}
              />
            </label>
            {error && (
              <p className="area-editor-wide appointment-editor-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="area-editor-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit" disabled={saving || !siteId}>
              <ModuleIcon name="check" /> {saving ? "Wird gespeichert …" : unit ? "Speichern" : "Wohnbereich erstellen"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
