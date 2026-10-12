"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { formatDate, useApiData } from "@/app/components/workspace-ui";
import { BELONGING_KINDS, type BelongingInventory, type BelongingKind } from "@/lib/belongings-shared";

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

// Wäsche- und Inventarliste der Person (A4 hoch) mit Unterschrift der Person bzw. Vertretung und der Mitarbeitenden.
export default function InventoryPrint() {
  const params = useSearchParams();
  const residentId = params.get("resident") ?? "";
  const { data, error } = useApiData<BelongingInventory>(
    `/api/residents/${encodeURIComponent(residentId || "keine")}/inventory`,
  );
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);

  const kinds = (Object.keys(BELONGING_KINDS) as BelongingKind[]).filter((kind) =>
    data?.belongings.some((item) => item.kind === kind),
  );

  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Inventarliste</strong>
        <span>A4 hoch · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {(error || !data) && <h1 className="print-hidden-heading">Inventarliste</h1>}
      {error ? (
        <p className="roster-print-message" role="alert">
          Die Inventarliste konnte nicht erstellt werden: {error}
        </p>
      ) : !data ? (
        <p className="roster-print-message">Liste wird erstellt …</p>
      ) : (
        <article className="evacuation-sheet inventory-sheet" aria-label={`Inventarliste ${data.residentName}`}>
          <header>
            <h1>
              Wäsche- und Inventarliste · {data.residentName}
              <span>{data.organization}</span>
            </h1>
            <p>
              {[
                data.room && (/^zimmer\b/i.test(data.room) ? data.room : `Zimmer ${data.room}`),
                data.careUnit,
                data.admittedOn && `Eintritt ${formatDate(data.admittedOn)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              {" · "}
              <strong>Stand: {stamp(data.generatedAt)}</strong>
            </p>
          </header>
          {!data.belongings.length ? (
            <p className="roster-print-message">Keine Gegenstände erfasst.</p>
          ) : (
            kinds.map((kind) => (
              <section key={kind} aria-label={BELONGING_KINDS[kind]}>
                <h2>{BELONGING_KINDS[kind]}</h2>
                <table>
                  <thead>
                    <tr>
                      <th scope="col" className="number">
                        Anzahl
                      </th>
                      <th scope="col">Gegenstand</th>
                      <th scope="col">Kennzeichnung</th>
                      <th scope="col">Standort</th>
                      <th scope="col">Bemerkung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.belongings
                      .filter((item) => item.kind === kind)
                      .map((item) => (
                        <tr key={item.id}>
                          <td className="number">{item.quantity}</td>
                          <td>
                            <strong>{item.name}</strong>
                          </td>
                          <td>{item.marking || "–"}</td>
                          <td>{item.location || "–"}</td>
                          <td>{item.note || "–"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            ))
          )}
          <footer className="inventory-signatures">
            <p>Die aufgeführten Gegenstände wurden gemeinsam erfasst.</p>
            <div>
              <span>Ort, Datum</span>
              <span>Person bzw. Vertretung</span>
              <span>Mitarbeitende Person</span>
            </div>
          </footer>
        </article>
      )}
    </main>
  );
}
