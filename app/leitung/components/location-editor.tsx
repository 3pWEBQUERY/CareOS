"use client";

import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { requestJson } from "@/app/components/workspace-ui";
import {
  COUNTRIES,
  SITE_STATUS,
  SITE_TYPES,
  type OrgPerson,
  type OrgSite,
  type SiteStatus,
} from "@/lib/organization-shared";
import { AreaSelect } from "./leadership-variant-parts";

const NONE = "";

// Creates a site, or edits `site`. Rendered only while open so the form starts from the site.
export function LocationEditor({
  site,
  people,
  onClose,
  onSaved,
  showToast,
}: {
  site: OrgSite | null;
  people: OrgPerson[];
  onClose: () => void;
  onSaved: () => void;
  showToast: (message: string) => void;
}) {
  const [siteName, setSiteName] = useState(site?.name ?? "");
  const [siteCode, setSiteCode] = useState(site?.code ?? "");
  const [siteType, setSiteType] = useState(site?.siteType || SITE_TYPES[0]);
  const [siteCountry, setSiteCountry] = useState(site?.country || COUNTRIES[0]);
  const [address, setAddress] = useState(site?.addressLine1 ?? "");
  const [place, setPlace] = useState([site?.postalCode, site?.city].filter(Boolean).join(" "));
  const [managerId, setManagerId] = useState(site?.managerId ?? NONE);
  const [siteStatus, setSiteStatus] = useState<SiteStatus>(site?.status ?? "active");
  const [notes, setNotes] = useState(site?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const personName = (id: string) =>
    id === NONE ? "Noch nicht festgelegt" : (people.find((person) => person.id === id)?.name ?? "Unbekannt");

  const submit = async () => {
    const match = /^(\d{4,5})\s+(.+)$/.exec(place.trim());
    setSaving(true);
    setError("");
    try {
      await requestJson(site ? `/api/organization/sites/${site.id}` : "/api/organization/sites", {
        method: site ? "PATCH" : "POST",
        body: {
          name: siteName,
          code: siteCode,
          siteType,
          country: siteCountry,
          addressLine1: address,
          postalCode: match ? match[1] : "",
          city: match ? match[2] : place.trim(),
          phone: site?.phone ?? "",
          email: site?.email ?? "",
          managerId: managerId || null,
          status: siteStatus,
          notes,
        },
      });
      onSaved();
      onClose();
      showToast(site ? `${siteName} wurde gespeichert` : `${siteName} wurde angelegt`);
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
      <section className="area-editor-panel" role="dialog" aria-modal="true" aria-labelledby="location-editor-title">
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">Administration · Organisation</p>
            <h2 id="location-editor-title">{site ? "Standort bearbeiten" : "Standort erstellen"}</h2>
            <p>
              {site
                ? "Passe die Organisationsdaten des Standorts an."
                : "Lege einen neuen Standort an und hinterlege die wichtigsten Organisationsdaten."}
            </p>
          </div>
          <button className="area-editor-close" type="button" onClick={onClose} aria-label="Standorteditor schliessen">
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
              <strong>{site ? site.name : "Neuer Standort"}</strong>
              <p>Alle Angaben können später in der Organisation bearbeitet werden.</p>
            </div>
          </div>
          <div className="area-editor-grid">
            <label>
              Standortname
              <input
                value={siteName}
                onChange={(event) => setSiteName(event.target.value)}
                placeholder="z. B. Alterszentrum Sonnengarten"
                maxLength={180}
                required
              />
            </label>
            <label>
              Kürzel
              <input
                value={siteCode}
                onChange={(event) => setSiteCode(event.target.value.toUpperCase())}
                placeholder="z. B. AZS"
                maxLength={6}
              />
            </label>
            <label>
              Standorttyp
              <AreaSelect label="Standorttyp" value={siteType} options={SITE_TYPES} onChange={setSiteType} />
            </label>
            <label>
              Land
              <AreaSelect label="Land" value={siteCountry} options={COUNTRIES} onChange={setSiteCountry} />
            </label>
            <label>
              Adresse
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="z. B. Gartenstrasse 12"
                maxLength={180}
              />
            </label>
            <label>
              PLZ und Ort
              <input
                value={place}
                onChange={(event) => setPlace(event.target.value)}
                placeholder="z. B. 8001 Zürich"
                maxLength={140}
              />
            </label>
            <label className="area-editor-wide">
              Verantwortliche Leitung
              <AreaSelect
                label="Verantwortliche Leitung"
                value={managerId}
                options={[NONE, ...people.map((person) => person.id)]}
                onChange={setManagerId}
                format={personName}
              />
            </label>
            <label>
              Status
              <AreaSelect
                label="Status"
                value={siteStatus}
                options={Object.keys(SITE_STATUS)}
                onChange={(value) => setSiteStatus(value as SiteStatus)}
                format={(value) => SITE_STATUS[value as SiteStatus]}
              />
            </label>
            <label className="area-editor-wide">
              Hinweis oder Zweck
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="z. B. Hauptstandort mit vier Wohnbereichen …"
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
            <button className="primary-button" type="submit" disabled={saving}>
              <ModuleIcon name="check" /> {saving ? "Wird gespeichert …" : site ? "Speichern" : "Standort erstellen"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
