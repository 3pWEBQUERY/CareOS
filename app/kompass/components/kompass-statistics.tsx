"use client";

import { useMemo, useState } from "react";
import { useTerms } from "@/app/components/care-context";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import { LoadError, useApiData } from "@/app/components/workspace-ui";
import { KOMPASS_DOMAINS, NOT_APPLICABLE_LABEL } from "@/lib/kompass-instrument";
import type { KompassStatistics } from "@/lib/kompass-shared";
import type { RaiData } from "./rai-data";

const ALL = "all";

// Auswertung je Wohnbereich: wie viele Personen in welchem Bereich Unterstützung brauchen oder bei denen etwas
// beobachtet wurde, und wie sich die Antworten je Frage verteilen. Nur gezählt, ohne Wertung.
export function KompassStatisticsView({ rai }: { rai: RaiData }) {
  const t = useTerms();
  const [unit, setUnit] = useState(ALL);
  const [open, setOpen] = useState<string | null>(null);
  const query = unit === ALL ? "" : `?careUnitId=${encodeURIComponent(unit)}`;
  const statistics = useApiData<KompassStatistics>(`/api/rai/statistics${query}`);
  const units = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rai.data?.residents ?? []) if (row.careUnitId) seen.set(row.careUnitId, row.unit);
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rai.data]);
  const data = statistics.data;
  const download = () => {
    const link = document.createElement("a");
    link.href = `/api/rai/statistics${query ? `${query}&` : "?"}format=csv`;
    link.click();
  };
  return (
    <section className="card kompass-statistics" aria-labelledby="kompass-statistics-title">
      <div className="rai-card-header">
        <div>
          <p className="eyebrow">Auswertung je Wohnbereich</p>
          <h2 className="card-title" id="kompass-statistics-title">
            Unterstützung je Bereich
          </h2>
          <p className="card-subtitle">
            {data
              ? `${data.assessed} von ${data.people} ${t.manyDative} mit abgeschlossener Abklärung. Gezählt wird die letzte Abklärung je ${t.one}.`
              : "Wird geladen …"}
          </p>
        </div>
        <div className="kompass-statistics-actions">
          <CareOptionSelect
            label="Wohnbereich"
            className="kompass-unit-select"
            value={unit}
            options={[{ value: ALL, label: "Ganzes Haus" }, ...units]}
            onChange={(value) => {
              setUnit(value);
              setOpen(null);
            }}
          />
          <button className="secondary-button" type="button" onClick={download} disabled={!data}>
            Exportieren <ModuleIcon name="docs" />
          </button>
        </div>
      </div>
      {statistics.error && !data ? (
        <LoadError message={statistics.error} onRetry={statistics.reload} />
      ) : data && !data.assessed ? (
        <div className="resident-empty">
          <ModuleIcon name="compass" />
          <strong>Noch keine Auswertung</strong>
          <p>Sobald Abklärungen abgeschlossen sind, erscheinen hier die Zahlen.</p>
        </div>
      ) : data ? (
        <div className="kompass-statistics-list">
          <div className="kompass-statistics-head" aria-hidden="true">
            <span>Bereich</span>
            <span>Unterstützung oder Beobachtung</span>
            <span>Handlungsbedarf</span>
            <span />
          </div>
          {data.domains.map((domain) => {
            const icon = KOMPASS_DOMAINS.find((entry) => entry.id === domain.id)?.icon ?? "compass";
            const expanded = open === domain.id;
            return (
              <article key={domain.id} className={expanded ? "open" : ""}>
                <button
                  type="button"
                  className="kompass-statistics-row"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : domain.id)}
                >
                  <span className="kompass-statistics-domain">
                    <span className="kompass-domain-icon">
                      <ModuleIcon name={icon} />
                    </span>
                    <strong>{domain.title}</strong>
                  </span>
                  <Share label="Unterstützung oder Beobachtung" count={domain.withSupport} total={data.assessed} />
                  <Share label="Handlungsbedarf" count={domain.withNeed} total={data.assessed} need />
                  <ModuleIcon name="chevron" />
                </button>
                {expanded && (
                  <div className="kompass-statistics-items">
                    {domain.items.map((item) => (
                      <div key={item.key} className="kompass-statistics-item">
                        <strong>{item.label}</strong>
                        <div className="kompass-statistics-bar" aria-hidden="true">
                          {item.counts.map((count, index) =>
                            count.count ? (
                              <span
                                key={count.value}
                                className={`level-${index}`}
                                style={{ flexGrow: count.count }}
                                title={`${count.label}: ${count.count}`}
                              />
                            ) : null,
                          )}
                          {item.notApplicable ? (
                            <span className="level-na" style={{ flexGrow: item.notApplicable }} />
                          ) : null}
                        </div>
                        <ul>
                          {item.counts.map((count, index) => (
                            <li key={count.value}>
                              <i className={`level-${index}`} />
                              {count.label} <b>{count.count}</b>
                            </li>
                          ))}
                          {item.notApplicable ? (
                            <li>
                              <i className="level-na" />
                              {NOT_APPLICABLE_LABEL} <b>{item.notApplicable}</b>
                            </li>
                          ) : null}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function Share({ label, count, total, need }: { label: string; count: number; total: number; need?: boolean }) {
  return (
    <span className="kompass-statistics-share">
      <span className="kompass-statistics-meter">
        <span className={need ? "need" : ""} style={{ width: `${total ? (count / total) * 100 : 0}%` }} />
      </span>
      <small>
        <span className="kompass-statistics-share-label">{label}: </span>
        {count} von {total}
      </small>
    </span>
  );
}
