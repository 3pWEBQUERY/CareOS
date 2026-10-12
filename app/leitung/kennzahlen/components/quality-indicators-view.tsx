"use client";

import Link from "next/link";
import { useState } from "react";
import { setCareResident, useTerms, useWorkContext } from "@/app/components/care-context";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import { LoadError, formatDateTime, useApiData } from "@/app/components/workspace-ui";
import { BASIS_LABELS, type IndicatorResult, type QualityIndicators } from "@/lib/quality-indicators-shared";
import { LeadershipHeading, LeadershipKpis } from "../../components/leadership-page-parts";

const COUNTRY_NOTE = {
  CH: "Berechnet nach den medizinischen Qualitätsindikatoren (MQI) für Pflegeheime. Die offizielle Erhebung läuft über das Bedarfsabklärungsinstrument (interRAI LTCF, BESA oder Plaisir); diese Auswertung dient der internen Steuerung.",
  DE: "Die Auswertung folgt den Schweizer MQI. Die Qualitätsindikatoren nach § 113 SGB XI beruhen auf der halbjährlichen Ergebniserfassung und sind darin nicht enthalten.",
  AT: "Die Auswertung folgt den Schweizer MQI und dient der internen Steuerung; österreichische Vorgaben der Länder sind darin nicht enthalten.",
} as const;

const value = (indicator: IndicatorResult) =>
  indicator.percent === null ? "–" : `${indicator.percent.toLocaleString("de-CH")} %`;

function csv(data: QualityIndicators, unitName: string) {
  const cell = (text: string | number) => `"${String(text).replaceAll('"', '""')}"`;
  const rows = [
    ["Stichtag", formatDateTime(data.measuredAt)],
    ["Bereich", unitName],
    [],
    ["Indikator", "Grundlage", "Anteil (%)", "Zähler", "Nenner", "Ohne Daten"],
    ...data.indicators.map((indicator) => [
      indicator.title,
      BASIS_LABELS[indicator.basis],
      indicator.percent ?? "",
      indicator.numerator,
      indicator.denominator,
      indicator.notAssessable,
    ]),
  ];
  return rows.map((row) => row.map(cell).join(";")).join("\r\n");
}

// Leitung › Qualität & Kennzahlen › Qualitätsindikatoren: Anteile nach MQI und die gezählten Personen.
export default function QualityIndicatorsView() {
  const t = useTerms();
  const context = useWorkContext();
  const [unitId, setUnitId] = useState("");
  const data = useApiData<QualityIndicators>(
    `/api/quality-indicators${unitId ? `?careUnitId=${encodeURIComponent(unitId)}` : ""}`,
  );
  const units = context?.careUnits ?? [];
  const unitName = units.find((unit) => unit.id === unitId)?.name ?? "Alle Wohnbereiche";
  const country = context?.country ?? "CH";

  function download() {
    if (!data.data) return;
    const blob = new Blob([`﻿${csv(data.data, unitName)}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `qualitaetsindikatoren-${data.data.measuredAt.slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <ModulePageShell activeModule="quality" activeChild="Qualitätsindikatoren" pageClass="leadership-page">
      {() => (
        <main className="workspace leadership-workspace quality-indicators-page">
          <LeadershipHeading
            eyebrow="Qualität & Kennzahlen"
            title="Qualitätsindikatoren"
            description={`Anteile der ${t.many} je Indikator am heutigen Stichtag, mit den gezählten Personen.`}
            action={data.data ? { label: "CSV exportieren", icon: "docs", onClick: download } : undefined}
          />
          <section className="quality-indicators-toolbar">
            <CareOptionSelect
              label="Wohnbereich"
              value={unitId}
              onChange={setUnitId}
              options={[
                { value: "", label: "Alle Wohnbereiche" },
                ...units.map((unit) => ({ value: unit.id, label: unit.name })),
              ]}
            />
            <p>{COUNTRY_NOTE[country]}</p>
          </section>
          {data.error && <LoadError message={data.error} onRetry={data.reload} />}
          {data.loading && !data.data && <p className="quality-indicators-empty">Indikatoren werden berechnet…</p>}
          {data.data && (
            <>
              <LeadershipKpis
                kpis={data.data.indicators.map((indicator) => ({
                  value: value(indicator),
                  label: indicator.title,
                  note: `${indicator.numerator} von ${indicator.denominator}`,
                }))}
              />
              <p className="quality-indicators-meta">
                Stichtag {formatDateTime(data.data.measuredAt)} · {data.data.population} {t.many} · {unitName}
              </p>
              <div className="quality-indicators-list">
                {data.data.indicators.map((indicator) => (
                  <section className="card quality-indicator-card" key={indicator.key} aria-label={indicator.title}>
                    <header>
                      <div>
                        <h2 className="card-title">{indicator.title}</h2>
                        <p className="card-subtitle">{indicator.definition}</p>
                      </div>
                      <div className="quality-indicator-value">
                        <strong>{value(indicator)}</strong>
                        <span className={`status-badge ${indicator.basis === "exact" ? "stable" : "attention"}`}>
                          {BASIS_LABELS[indicator.basis]}
                        </span>
                      </div>
                    </header>
                    <p className="quality-indicator-method">
                      <strong>So zählt CareOS:</strong> {indicator.method}
                      {indicator.notAssessable > 0 &&
                        ` ${indicator.notAssessable} ${indicator.notAssessable === 1 ? t.one : t.many} ohne ausreichende Daten (nicht im Nenner).`}
                    </p>
                    {indicator.residents.length ? (
                      <ul className="quality-indicator-residents">
                        {indicator.residents.map((resident) => (
                          <li key={resident.id}>
                            <Link
                              href={`/c/bewohner?resident=${resident.id}`}
                              onClick={() => setCareResident(resident.id)}
                            >
                              {resident.name}
                            </Link>
                            <span>{[resident.room, resident.detail].filter(Boolean).join(" · ")}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="quality-indicators-empty">Niemand gezählt.</p>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
        </main>
      )}
    </ModulePageShell>
  );
}
