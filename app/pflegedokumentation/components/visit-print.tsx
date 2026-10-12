"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { useTerms, useWorkContext } from "@/app/components/care-context";
import { formatDateTime, useApiData } from "@/app/components/workspace-ui";
import type { VisitOverview } from "@/lib/visits-shared";

// Visitenliste (A4 hoch): offene Fragen je Hausärztin bzw. Hausarzt mit Platz für die Rückmeldung.
export default function VisitPrint() {
  const t = useTerms();
  const context = useWorkContext();
  const params = useSearchParams();
  const unitId = params.get("careUnitId") ?? "";
  const { data, error } = useApiData<VisitOverview>(
    `/api/visits${unitId ? `?careUnitId=${encodeURIComponent(unitId)}` : ""}`,
  );
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);

  const unitName = context?.careUnits.find((unit) => unit.id === unitId)?.name ?? "Alle Wohnbereiche";

  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Visitenliste</strong>
        <span>A4 hoch · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {(error || !data) && <h1 className="print-hidden-heading">Visitenliste</h1>}
      {error ? (
        <p className="roster-print-message" role="alert">
          Die Visitenliste konnte nicht erstellt werden: {error}
        </p>
      ) : !data ? (
        <p className="roster-print-message">Visitenliste wird erstellt …</p>
      ) : (
        <article className="transfer-sheet visit-sheet">
          <header className="transfer-head">
            <div>
              <p>Visitenliste · Fragen der Pflege</p>
              <h1>{unitName}</h1>
              <span>
                Stand {formatDateTime(new Date().toISOString())} · {data.open}{" "}
                {data.open === 1 ? "offene Frage" : "offene Fragen"}
              </span>
            </div>
            {context?.profile.organizationName && (
              <div className="transfer-facility">
                <strong>{context.profile.organizationName}</strong>
              </div>
            )}
          </header>
          {!data.groups.length && <p className="visit-sheet-empty">Keine offenen Fragen für die Visite.</p>}
          {data.groups.map((group) => (
            <section key={group.physician?.name ?? "none"}>
              <h2>
                {group.physician?.name ?? "Hausarzt nicht erfasst"}
                {group.physician && (
                  <span>{[group.physician.practice, group.physician.phone].filter(Boolean).join(" · ")}</span>
                )}
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>{t.one}</th>
                    <th>Frage der Pflege</th>
                    <th>Rückmeldung</th>
                  </tr>
                </thead>
                <tbody>
                  {group.residents.flatMap((resident) =>
                    resident.items.map((item, index) => (
                      <tr key={item.id}>
                        <td>
                          {index === 0 && (
                            <>
                              <strong>{resident.name}</strong>
                              <small>{[resident.room, resident.careUnit].filter(Boolean).join(" · ")}</small>
                              {resident.diagnoses.length > 0 && (
                                <small className="visit-diagnoses">Diagnosen: {resident.diagnoses.join(" · ")}</small>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          {item.body}
                          <small>
                            {formatDateTime(item.occurredAt)} · {item.author}
                          </small>
                        </td>
                        <td className="visit-sheet-answer" />
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </section>
          ))}
        </article>
      )}
    </main>
  );
}
