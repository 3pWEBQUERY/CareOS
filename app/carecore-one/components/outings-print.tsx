"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { formatDate, timeInZurich, useApiData } from "@/app/components/workspace-ui";
import type { OutingDay } from "@/lib/outings-shared";
import { outingLogistics, outingState } from "./outings-view";

// Tagesliste Fahrdienst zum Drucken (A4 quer): Termine ausser Haus eines Tages für den Empfang.
export default function OutingsPrint() {
  const params = useSearchParams();
  const date = params.get("date") ?? "";
  const { data, error } = useApiData<OutingDay>(`/api/appointments/outings${date ? `?date=${date}` : ""}`);
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);

  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Tagesliste Fahrdienst</strong>
        <span>A4 quer · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {(error || !data) && <h1 className="print-hidden-heading">Tagesliste Fahrdienst</h1>}
      {error ? (
        <p className="roster-print-message" role="alert">
          Die Tagesliste konnte nicht erstellt werden: {error}
        </p>
      ) : !data ? (
        <p className="roster-print-message">Liste wird erstellt …</p>
      ) : (
        <article
          className="evacuation-sheet kitchen-sheet"
          aria-label={`Tagesliste Fahrdienst ${formatDate(data.date)}`}
        >
          <header>
            <h1>
              Tagesliste Fahrdienst · {formatDate(data.date)}
              <span>{data.organization}</span>
            </h1>
            <p>
              <strong>Stand: {timeInZurich()}</strong> · {data.outings.length}{" "}
              {data.outings.length === 1 ? "Termin" : "Termine"} ausser Haus
            </p>
          </header>
          {!data.outings.length ? (
            <p className="roster-print-message">An diesem Tag ist kein Termin ausser Haus erfasst.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Zeit</th>
                  <th scope="col">Name / Zimmer</th>
                  <th scope="col">Termin / Ort</th>
                  <th scope="col">Abholung, Transport, Begleitung</th>
                  <th scope="col">Mitzugeben</th>
                  <th scope="col">Stand</th>
                </tr>
              </thead>
              <tbody>
                {data.outings.map((outing) => (
                  <tr key={outing.id}>
                    <td>
                      {timeInZurich(new Date(outing.startsAt))}–{timeInZurich(new Date(outing.endsAt))}
                    </td>
                    <td>
                      <strong>{outing.residentName}</strong>
                      <small>{[outing.room, outing.careUnit].filter(Boolean).join(" · ") || "ohne Zimmer"}</small>
                    </td>
                    <td>
                      {outing.title}
                      <small>{[outing.category, outing.location].filter(Boolean).join(" · ")}</small>
                    </td>
                    <td>{outingLogistics(outing)}</td>
                    <td>{outing.documents || "–"}</td>
                    <td>{outingState(outing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      )}
    </main>
  );
}
