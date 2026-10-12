"use client";

import Link from "next/link";
import { useState } from "react";
import { setCareResident, useTerms } from "@/app/components/care-context";
import ModulePageShell from "@/app/components/module-page-shell";
import { LoadError, PageHeading, formatDate, useApiData } from "@/app/components/workspace-ui";
import { CONSENT_STATUS, type ConsentOverview, type ConsentStatus } from "@/lib/consents-shared";

const ORDER: ConsentStatus[] = ["refused", "revoked", "missing", "granted"];

function ConsentsContent() {
  const t = useTerms();
  const [topic, setTopic] = useState("");
  const { data, error, reload } = useApiData<ConsentOverview>(
    `/api/consents${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`,
  );
  const shown = topic || data?.topic || "";
  return (
    <>
      <PageHeading
        eyebrow={`CareOS ${t.many}`}
        title="Einwilligungen"
        description="Stand je Thema und Wohnbereich – z. B. wer keine Fotos möchte. Erfasst wird in der Akte unter Stammdaten › Einwilligungen & Freigaben."
      />
      {error && <LoadError message={error} onRetry={reload} />}
      {data && !data.topics.length ? (
        <section className="card hygiene-empty">
          <strong>Noch keine Themen festgelegt</strong>
          <p>Die Administration legt die Themen unter Leitung › Konfiguration › „Themen der Einwilligungen“ fest.</p>
        </section>
      ) : data ? (
        <section className="card vaccination-overview" aria-labelledby="consent-overview-title">
          <header>
            <h2 className="card-title" id="consent-overview-title">
              {shown}
            </h2>
            <p className="card-subtitle">Abgelehnt und widerrufen zuerst, danach nicht erfasst und zugestimmt.</p>
          </header>
          <div className="vaccination-filters">
            <div className="repositioning-choices" role="group" aria-label="Thema">
              {data.topics.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`day-toggle ${shown.toLowerCase() === item.toLowerCase() ? "active" : ""}`}
                  aria-pressed={shown.toLowerCase() === item.toLowerCase()}
                  onClick={() => setTopic(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          {data.units.map((unit) => {
            const residents = [...unit.residents].sort(
              (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name),
            );
            const granted = unit.residents.filter((resident) => resident.status === "granted").length;
            return (
              <div key={unit.id} className="vaccination-unit">
                <h3>
                  {unit.name}
                  <span>
                    {granted} von {unit.residents.length} zugestimmt
                  </span>
                </h3>
                <ul aria-label={`Einwilligungen ${unit.name}`}>
                  {residents.map((resident) => (
                    <li key={resident.id} className={`consent-row ${resident.status}`}>
                      <span>
                        <Link href={`/c/bewohner?resident=${resident.id}`} onClick={() => setCareResident(resident.id)}>
                          {resident.name}
                        </Link>
                        {resident.room && <small> · {resident.room}</small>}
                      </span>
                      <small>
                        {CONSENT_STATUS[resident.status]}
                        {resident.since ? ` · ${formatDate(resident.since)}` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ) : (
        !error && <p className="record-export-note">Wird geladen …</p>
      )}
    </>
  );
}

// Bewohner › Einwilligungen.
export default function ConsentsView() {
  return (
    <ModulePageShell activeModule="residents" activeChild="Einwilligungen" pageClass="consents-page">
      {() => (
        <main className="workspace module-workspace consents-workspace">
          <ConsentsContent />
        </main>
      )}
    </ModulePageShell>
  );
}
